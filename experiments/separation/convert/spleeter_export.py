"""Exports Deezer Spleeter checkpoints (TF1) to ONNX for the browser spike.

    python -I spleeter_export.py <checkpoint dir> <4stems|5stems> <out.onnx> [--fp32]

Spleeter's U-Net is re-built in PyTorch (layer by layer, from
spleeter/model/functions/unet.py), the TF weights are copied in, and the
result is exported with ONNX weights stored as float16 (fp32 compute: each
weight goes through a Cast node), so the file is half the size and every
onnxruntime-web backend can run it.

Interface (same as the Best-Practice 4stems export, so the JS code is shared):
    x : float32 [2, splits, 512, 1024]       stereo magnitude, 1024 lowest bins
    y : float32 [S, 2, splits, 512, 1024]    estimated magnitude per stem
4stems: S = 4 independent sigmoid-mask U-Nets (vocals, drums, bass, other)
5stems: S = 5 U-Nets whose logits are soft-maxed across stems
        (vocals, piano, drums, bass, other), as in spleeter's softmax_unet.

Needs: tensorflow (only to read the checkpoint), torch, onnx, numpy.
"""
import sys

import numpy as np
import onnx
import torch
import torch.nn.functional as Fn
from onnx import helper, numpy_helper, TensorProto

INSTRUMENTS = {
    '4stems': ['vocals', 'drums', 'bass', 'other'],
    '5stems': ['vocals', 'piano', 'drums', 'bass', 'other'],
}
FILTERS = [16, 32, 64, 128, 256, 512]


def load_tf(ckpt_dir):
    import tensorflow as tf
    reader = tf.train.load_checkpoint(ckpt_dir + '/model')
    return {k: reader.get_tensor(k) for k in reader.get_variable_to_shape_map() if 'Adam' not in k and 'power' not in k}


def suffix(name, i):
    return name if i == 0 else f'{name}_{i}'


class UNet(torch.nn.Module):
    """One Spleeter U-Net. TF 'same' padding is reproduced explicitly."""

    def __init__(self, w, index):
        super().__init__()
        c0, t0, b0 = 7 * index, 6 * index, 12 * index
        p = lambda a: torch.nn.Parameter(torch.from_numpy(np.ascontiguousarray(a)).float(), requires_grad=False)
        self.conv = torch.nn.ParameterList()
        self.conv_b = torch.nn.ParameterList()
        for j in range(7):
            k = w[suffix('conv2d', c0 + j) + '/kernel']  # [kh, kw, in, out]
            self.conv.append(p(k.transpose(3, 2, 0, 1)))
            self.conv_b.append(p(w[suffix('conv2d', c0 + j) + '/bias']))
        self.deconv = torch.nn.ParameterList()
        self.deconv_b = torch.nn.ParameterList()
        for j in range(6):
            k = w[suffix('conv2d_transpose', t0 + j) + '/kernel']  # [kh, kw, out, in]
            self.deconv.append(p(k.transpose(3, 2, 0, 1)))  # torch: [in, out, kh, kw]
            self.deconv_b.append(p(w[suffix('conv2d_transpose', t0 + j) + '/bias']))
        self.bn = []
        for j in range(12):
            n = suffix('batch_normalization', b0 + j)
            g, b, m, v = (w[f'{n}/{x}'] for x in ('gamma', 'beta', 'moving_mean', 'moving_variance'))
            scale = g / np.sqrt(v + 1e-3)
            shift = b - m * scale
            self.bn.append((p(scale), p(shift)))
        for j, (s, t) in enumerate(self.bn):
            self.register_parameter(f'bn{j}_s', s)
            self.register_parameter(f'bn{j}_t', t)

    def bnorm(self, x, j):
        s, t = self.bn[j]
        return x * s.view(1, -1, 1, 1) + t.view(1, -1, 1, 1)

    def down(self, x, j):
        x = Fn.pad(x, (1, 2, 1, 2))  # TF same, stride 2, kernel 5
        return Fn.conv2d(x, self.conv[j], self.conv_b[j], stride=2)

    def up(self, x, j):
        h, w_ = x.shape[2], x.shape[3]
        y = Fn.conv_transpose2d(x, self.deconv[j], self.deconv_b[j], stride=2)
        return y[:, :, 1:1 + 2 * h, 1:1 + 2 * w_]

    def forward(self, x):  # x: [B, 2, T, F]
        elu = Fn.elu
        conv1 = self.down(x, 0); r = elu(self.bnorm(conv1, 0))
        conv2 = self.down(r, 1); r = elu(self.bnorm(conv2, 1))
        conv3 = self.down(r, 2); r = elu(self.bnorm(conv3, 2))
        conv4 = self.down(r, 3); r = elu(self.bnorm(conv4, 3))
        conv5 = self.down(r, 4); r = elu(self.bnorm(conv5, 4))
        conv6 = self.down(r, 5)  # its BN + activation feed nothing
        u = self.bnorm(elu(self.up(conv6, 0)), 6)
        u = self.bnorm(elu(self.up(torch.cat([conv5, u], 1), 1)), 7)
        u = self.bnorm(elu(self.up(torch.cat([conv4, u], 1), 2)), 8)
        u = self.bnorm(elu(self.up(torch.cat([conv3, u], 1), 3)), 9)
        u = self.bnorm(elu(self.up(torch.cat([conv2, u], 1), 4)), 10)
        u = self.bnorm(elu(self.up(torch.cat([conv1, u], 1), 5)), 11)
        u = Fn.pad(u, (3, 3, 3, 3))  # 4x4 kernel, dilation 2, same
        return Fn.conv2d(u, self.conv[6], self.conv_b[6], dilation=2)  # mask logits [B, 2, T, F]


class Separator(torch.nn.Module):
    def __init__(self, w, n, softmax):
        super().__init__()
        self.nets = torch.nn.ModuleList([UNet(w, i) for i in range(n)])
        self.softmax = softmax

    def forward(self, x):  # x: [2, splits, T, F]
        mix = x.permute(1, 0, 2, 3)  # [splits, 2, T, F]
        logits = torch.stack([net(mix) for net in self.nets], 0)  # [S, splits, 2, T, F]
        masks = torch.softmax(logits, 0) if self.softmax else torch.sigmoid(logits)
        return (masks * mix.unsqueeze(0)).permute(0, 2, 1, 3, 4)  # [S, 2, splits, T, F]


def weights_to_fp16(path):
    model = onnx.load(path)
    g = model.graph
    new_inits, casts = [], []
    for init in g.initializer:
        arr = numpy_helper.to_array(init)
        if arr.dtype == np.float32 and arr.size > 64:
            half = numpy_helper.from_array(arr.astype(np.float16), init.name + '_fp16')
            new_inits.append(half)
            casts.append(helper.make_node('Cast', [half.name], [init.name], to=TensorProto.FLOAT))
        else:
            new_inits.append(init)
    del g.initializer[:]
    g.initializer.extend(new_inits)
    nodes = list(g.node)
    del g.node[:]
    g.node.extend(casts + nodes)
    onnx.checker.check_model(model)
    onnx.save(model, path)


def main():
    ckpt, kind, out = sys.argv[1], sys.argv[2], sys.argv[3]
    w = load_tf(ckpt)
    names = INSTRUMENTS[kind]
    model = Separator(w, len(names), softmax=(kind == '5stems')).eval()
    x = torch.rand(2, 1, 512, 1024) * 3
    with torch.no_grad():
        torch.onnx.export(model, (x,), out, input_names=['x'], output_names=['y'], opset_version=17,
                          dynamic_axes={'x': {1: 'splits'}, 'y': {2: 'splits'}}, dynamo=False)
    if '--fp32' not in sys.argv:
        weights_to_fp16(out)
    m = onnx.load(out)
    m.metadata_props.add(key='stems', value=','.join(names))
    m.metadata_props.add(key='source', value=f'Deezer Spleeter {kind} v1.4.0 checkpoint (MIT), converted for a browser spike')
    onnx.save(m, out)
    print('wrote', out, 'stems', names)


if __name__ == '__main__':
    main()
