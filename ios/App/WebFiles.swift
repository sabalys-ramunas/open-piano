import Foundation
import UniformTypeIdentifiers
import WebKit

/// Serves the built web app from the app bundle at piano://app/, so pages,
/// modules, workers and fetch all work without a network.
///
/// File reads run off the main thread. Everything that touches a WKURLSchemeTask
/// runs on the main thread, and a task is forgotten as soon as WebKit stops it:
/// calling didReceive or didFinish on a stopped task raises an exception.
final class WebFiles: NSObject, WKURLSchemeHandler {
    static let scheme = "piano"
    static let home = URL(string: "piano://app/")!

    private let root = Bundle.main.resourceURL!.appendingPathComponent("web", isDirectory: true).standardizedFileURL
    private let io = DispatchQueue(label: "piano.webfiles.io", qos: .userInitiated, attributes: .concurrent)

    /// Tasks still waiting for their reply. Only touched on the main thread.
    /// A task is removed when it finishes or when WebKit stops it.
    private var active: [ObjectIdentifier: WKURLSchemeTask] = [:]

    private struct Reply {
        let response: HTTPURLResponse
        let body: Data?
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        let key = ObjectIdentifier(task)
        active[key] = task
        let request = task.request
        let root = self.root
        io.async {
            let reply = Self.reply(for: request, root: root)
            DispatchQueue.main.async { [weak self] in
                // Nil means WebKit already stopped this task. Do not touch it.
                guard let self, let task = self.active.removeValue(forKey: key) else { return }
                task.didReceive(reply.response)
                if let body = reply.body, !body.isEmpty { task.didReceive(body) }
                task.didFinish()
            }
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        active.removeValue(forKey: ObjectIdentifier(task))
    }

    // MARK: Building replies (runs off the main thread)

    private static func reply(for request: URLRequest, root: URL) -> Reply {
        let url = request.url ?? home
        let method = (request.httpMethod ?? "GET").uppercased()
        guard method == "GET" || method == "HEAD" else {
            return text(url, 405, "Method not allowed", extra: ["Allow": "GET, HEAD"])
        }
        let head = method == "HEAD"
        guard let file = fileURL(for: url, root: root),
              (try? file.resourceValues(forKeys: [.isRegularFileKey]))?.isRegularFile == true,
              let data = try? Data(contentsOf: file, options: .mappedIfSafe)
        else {
            return text(url, 404, "Not found")
        }
        let type = self.type(for: file.pathExtension)
        let total = data.count

        // Media elements ask for byte ranges. A malformed Range header is ignored, as HTTP allows.
        if let header = request.value(forHTTPHeaderField: "Range") {
            switch parseRange(header, total: total) {
            case .unsatisfiable:
                return text(url, 416, "Range not satisfiable", extra: ["Content-Range": "bytes */\(total)"])
            case .range(let range):
                let length = range.count
                let response = httpResponse(url, 206, [
                    "Content-Type": type,
                    "Content-Length": String(length),
                    "Content-Range": "bytes \(range.lowerBound)-\(range.upperBound - 1)/\(total)",
                ])
                return Reply(response: response, body: head ? nil : data.subdata(in: range))
            case .ignore:
                break
            }
        }

        let response = httpResponse(url, 200, [
            "Content-Type": type,
            "Content-Length": String(total),
            "Accept-Ranges": "bytes",
        ])
        return Reply(response: response, body: head ? nil : data)
    }

    /// Maps a piano://app/... URL to a file inside `root`, or nil if it would leave `root`.
    private static func fileURL(for url: URL, root: URL) -> URL? {
        guard url.scheme == scheme, var path = url.path.removingPercentEncoding, !path.contains("\0") else { return nil }
        if path.isEmpty || path.hasSuffix("/") { path += "index.html" }
        let file = root.appendingPathComponent(path).standardizedFileURL
        // The trailing slash matters: "/web" must not accept "/web-secrets".
        guard file.path.hasPrefix(root.path + "/") else { return nil }
        return file
    }

    private enum RangeResult {
        case range(Range<Int>)
        case unsatisfiable
        case ignore
    }

    /// Parses a single "bytes=a-b", "bytes=a-" or "bytes=-n" range.
    private static func parseRange(_ header: String, total: Int) -> RangeResult {
        let value = header.trimmingCharacters(in: .whitespaces)
        guard value.lowercased().hasPrefix("bytes=") else { return .ignore }
        let spec = value.dropFirst("bytes=".count)
        // Several ranges would need a multipart reply. Serving the whole file is allowed instead.
        guard !spec.contains(","), spec.split(separator: "-", omittingEmptySubsequences: false).count == 2 else { return .ignore }
        let parts = spec.split(separator: "-", omittingEmptySubsequences: false).map { $0.trimmingCharacters(in: .whitespaces) }
        let first = parts[0], last = parts[1]

        if first.isEmpty {
            // Suffix range: the last n bytes.
            guard let n = Int(last) else { return .ignore }
            guard n > 0, total > 0 else { return .unsatisfiable }
            return .range(max(0, total - n)..<total)
        }
        guard let start = Int(first), start >= 0 else { return .ignore }
        var end = total - 1
        if !last.isEmpty {
            guard let parsed = Int(last), parsed >= start else { return .ignore }
            end = min(parsed, total - 1)
        }
        guard start < total else { return .unsatisfiable }
        return .range(start..<(end + 1))
    }

    private static func text(_ url: URL, _ status: Int, _ message: String, extra: [String: String] = [:]) -> Reply {
        var headers = extra
        headers["Content-Type"] = "text/plain; charset=utf-8"
        headers["Content-Length"] = String(message.utf8.count)
        return Reply(response: httpResponse(url, status, headers), body: Data(message.utf8))
    }

    private static func httpResponse(_ url: URL, _ status: Int, _ headers: [String: String]) -> HTTPURLResponse {
        var all = headers
        all["Cache-Control"] = "no-cache"
        return HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: all)!
    }

    private static func type(for ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "map": return "application/json; charset=utf-8"
        case "webmanifest": return "application/manifest+json"
        case "wasm": return "application/wasm"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "mp3": return "audio/mpeg"
        case "woff2": return "font/woff2"
        case "txt", "md": return "text/plain; charset=utf-8"
        case "bin", "onnx": return "application/octet-stream"
        case "ogg", "opus": return "audio/ogg"
        case "wav": return "audio/wav"
        default: return UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
        }
    }
}
