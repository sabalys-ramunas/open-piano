import CoreMIDI
import Foundation

/// Listens to every MIDI keyboard the system knows (USB, and Bluetooth ones
/// paired in another app) and sends notes out to them.
///
/// Threading: all state is touched on the main thread only. CoreMIDI calls the
/// notify and receive blocks on its own threads, and those only hop to main.
final class MIDIBridge {
    struct PortInfo {
        let id: String
        let name: String
        let manufacturer: String
    }

    /// Called on the main thread when devices are plugged in or out.
    var onPorts: ((_ inputs: [PortInfo], _ outputs: [PortInfo]) -> Void)?
    /// Called on the main thread for each MIDI message: port id and its bytes.
    var onMessage: ((_ port: String, _ bytes: [UInt8]) -> Void)?

    private var client = MIDIClientRef()
    private var inPort = MIDIPortRef()
    private var outPort = MIDIPortRef()
    /// Keyed by endpoint, not by unique id: a replugged device gets a new endpoint,
    /// and two devices can (rarely) report the same unique id.
    private var connectedSources = Set<MIDIEndpointRef>()
    private var started = false

    func start() {
        if started {
            refresh()
            return
        }
        guard createPorts() else { return }
        started = true
        refresh()
    }

    /// Re-reads the device list, connects new inputs, drops unplugged ones and tells the page.
    func refresh() {
        #if DEBUG
        dispatchPrecondition(condition: .onQueue(.main))
        #endif
        var inputs: [PortInfo] = []
        var live = Set<MIDIEndpointRef>()
        for i in 0..<MIDIGetNumberOfSources() {
            let source = MIDIGetSource(i)
            guard source != 0 else { continue }
            let uid = uniqueID(source)
            live.insert(source)
            if !connectedSources.contains(source) {
                let status = MIDIPortConnectSource(inPort, source, MIDIBridge.refCon(for: uid))
                if MIDIBridge.check(status, "MIDIPortConnectSource") {
                    connectedSources.insert(source)
                }
            }
            inputs.append(info(source, uid))
        }
        // An unplugged source's endpoint may already be gone, so a failed disconnect is expected here.
        for gone in connectedSources.subtracting(live) {
            _ = MIDIPortDisconnectSource(inPort, gone)
        }
        connectedSources.formIntersection(live)

        var outputs: [PortInfo] = []
        for i in 0..<MIDIGetNumberOfDestinations() {
            let destination = MIDIGetDestination(i)
            guard destination != 0 else { continue }
            outputs.append(info(destination, uniqueID(destination)))
        }
        onPorts?(inputs, outputs)
    }

    /// Sends one MIDI 1.0 channel voice message (status 0x80 to 0xEF, with the
    /// right number of data bytes) to the output with this id. Other kinds of
    /// bytes, such as system exclusive, are not sent.
    func send(to port: String, bytes: [UInt8]) {
        #if DEBUG
        dispatchPrecondition(condition: .onQueue(.main))
        #endif
        guard outPort != 0, let word = MIDIBridge.channelVoiceWord(bytes) else { return }
        guard let destination = destination(withID: port) else { return }
        // One word fits in the event list's single packet, so the list's own size is the buffer size.
        var list = MIDIEventList()
        let status: OSStatus = withUnsafeMutablePointer(to: &list) { listPointer in
            let packet = MIDIEventListInit(listPointer, ._1_0)
            // The list is sized for one packet with room for 64 words, so this cannot fail in practice; check anyway.
            let added: UnsafeMutablePointer<MIDIEventPacket>? = MIDIEventListAdd(listPointer, MemoryLayout<MIDIEventList>.size, packet, 0, 1, [word])
            guard added != nil else { return kMIDIUnknownError }
            return MIDISendEventList(outPort, destination, listPointer)
        }
        _ = MIDIBridge.check(status, "MIDISendEventList")
    }

    // MARK: Setup

    /// Creates the client and ports. Returns false if the client or input port failed,
    /// so the next start() tries again.
    private func createPorts() -> Bool {
        var status = MIDIClientCreateWithBlock("Piano" as CFString, &client) { notification in
            // A removed object can free an endpoint, so drop every connection and reconnect from the fresh list.
            let removed = notification.pointee.messageID == .msgObjectRemoved
            DispatchQueue.main.async { [weak self] in self?.handleChange(removed: removed) }
        }
        guard MIDIBridge.check(status, "MIDIClientCreateWithBlock") else { return false }

        status = MIDIInputPortCreateWithProtocol(client, "Piano in" as CFString, ._1_0, &inPort) { [weak self] list, refCon in
            let port = MIDIBridge.portID(refCon: refCon)
            var messages: [[UInt8]] = []
            for packet in list.unsafeSequence() {
                // words() is sized by wordCount, so it is correct even for packets longer than the declared 64 words.
                messages += MIDIBridge.midi1Messages(UnsafePointer(packet).words())
            }
            guard !messages.isEmpty else { return }
            DispatchQueue.main.async {
                for bytes in messages { self?.onMessage?(port, bytes) }
            }
        }
        guard MIDIBridge.check(status, "MIDIInputPortCreateWithProtocol") else {
            _ = MIDIClientDispose(client)
            client = MIDIClientRef()
            return false
        }

        // Without an output port the page can still listen, so this is not fatal.
        _ = MIDIBridge.check(MIDIOutputPortCreate(client, "Piano out" as CFString, &outPort), "MIDIOutputPortCreate")
        return true
    }

    private func handleChange(removed: Bool) {
        if removed { disconnectAll() }
        refresh()
    }

    private func disconnectAll() {
        for source in connectedSources {
            _ = MIDIPortDisconnectSource(inPort, source)
        }
        connectedSources.removeAll()
    }

    // MARK: Devices

    private func destination(withID port: String) -> MIDIEndpointRef? {
        for i in 0..<MIDIGetNumberOfDestinations() {
            let destination = MIDIGetDestination(i)
            if destination != 0, MIDIBridge.portID(uniqueID: uniqueID(destination)) == port {
                return destination
            }
        }
        return nil
    }

    private func uniqueID(_ object: MIDIObjectRef) -> MIDIUniqueID {
        var uid: MIDIUniqueID = 0
        _ = MIDIBridge.check(MIDIObjectGetIntegerProperty(object, kMIDIPropertyUniqueID, &uid), "MIDIObjectGetIntegerProperty")
        return uid
    }

    private func info(_ object: MIDIObjectRef, _ uid: MIDIUniqueID) -> PortInfo {
        PortInfo(
            id: MIDIBridge.portID(uniqueID: uid),
            name: string(object, kMIDIPropertyDisplayName) ?? string(object, kMIDIPropertyName) ?? "MIDI keyboard",
            manufacturer: string(object, kMIDIPropertyManufacturer) ?? ""
        )
    }

    private func string(_ object: MIDIObjectRef, _ property: CFString) -> String? {
        var value: Unmanaged<CFString>?
        guard MIDIObjectGetStringProperty(object, property, &value) == noErr, let value else { return nil }
        let text = value.takeRetainedValue() as String
        return text.isEmpty ? nil : text
    }

    // MARK: Ids and refCons

    /// The id the page knows a device by. Both the receive side and the device list use this,
    /// so they always agree, including for negative and zero unique ids.
    private static func portID(uniqueID uid: MIDIUniqueID) -> String {
        String(uid)
    }

    /// The refCon is only a tag that CoreMIDI hands back, never dereferenced. The unique id
    /// is stored as the pointer value. A uid of 0 becomes nil, which decodes back to 0.
    private static func refCon(for uid: MIDIUniqueID) -> UnsafeMutableRawPointer? {
        UnsafeMutableRawPointer(bitPattern: Int(uid))
    }

    private static func portID(refCon: UnsafeMutableRawPointer?) -> String {
        portID(uniqueID: MIDIUniqueID(truncatingIfNeeded: Int(bitPattern: refCon)))
    }

    // MARK: Messages

    /// Decodes a run of Universal MIDI Packets and keeps the MIDI 1.0 channel voice messages (type 0x2).
    /// Each packet type has a fixed size, so a longer message (such as system exclusive, type 0x3) is
    /// skipped whole and its data words are never read as channel voice messages.
    static func midi1Messages<Words: RandomAccessCollection>(_ words: Words) -> [[UInt8]]
    where Words.Element == UInt32, Words.Index == Int {
        var messages: [[UInt8]] = []
        var index = words.startIndex
        while index < words.endIndex {
            let word = words[index]
            let type = word >> 28
            let size = umpWordCount(type: type)
            guard index + size <= words.endIndex else { break }
            if type == 0x2 {
                let status = UInt8((word >> 16) & 0xFF)
                guard status >= 0x80 else { index += size; continue }
                let first = UInt8((word >> 8) & 0x7F)
                let second = UInt8(word & 0x7F)
                let kind = status & 0xF0
                // Program change (0xC0) and channel pressure (0xD0) have one data byte.
                messages.append(kind == 0xC0 || kind == 0xD0 ? [status, first] : [status, first, second])
            }
            index += size
        }
        return messages
    }

    /// Number of 32-bit words in a Universal MIDI Packet of this message type (MIDIMessages.h).
    private static func umpWordCount(type: UInt32) -> Int {
        switch type {
        case 0x0...0x2, 0x6, 0x7: return 1
        case 0x3, 0x4, 0x8, 0x9, 0xA: return 2
        case 0xB, 0xC: return 3
        default: return 4 // 0x5, 0xD, 0xE, 0xF
        }
    }

    /// Packs a 1 to 3 byte channel voice message into a MIDI 1.0 Universal MIDI Packet word (type 0x2, group 0).
    private static func channelVoiceWord(_ bytes: [UInt8]) -> UInt32? {
        guard let status = bytes.first, status >= 0x80, status < 0xF0 else { return nil }
        let hasTwoDataBytes = (status & 0xF0) != 0xC0 && (status & 0xF0) != 0xD0
        guard bytes.count == (hasTwoDataBytes ? 3 : 2) else { return nil }
        let first = UInt32(bytes[1] & 0x7F)
        let second = hasTwoDataBytes ? UInt32(bytes[2] & 0x7F) : 0
        return 0x2000_0000 | UInt32(status) << 16 | first << 8 | second
    }

    // MARK: Errors

    /// Returns true on success. Failures are logged in DEBUG builds only.
    @discardableResult
    private static func check(_ status: OSStatus, _ call: String) -> Bool {
        #if DEBUG
        if status != noErr { NSLog("[MIDIBridge] %@ failed: %d", call, status) }
        #endif
        return status == noErr
    }
}
