import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

// Photos picked as they are on the phone (.current: no turning HEVC into H.264, no making smaller), each copied into
// the app's temporary folder for sending.
struct PhotoPicker: UIViewControllerRepresentable {
    var done: ([Picked], [String]) -> Void

    func makeUIViewController(context: Context) -> PHPickerViewController {
        var c = PHPickerConfiguration(photoLibrary: .shared())
        c.selectionLimit = 0
        c.preferredAssetRepresentationMode = .current
        c.selection = .ordered
        let p = PHPickerViewController(configuration: c)
        p.delegate = context.coordinator
        return p
    }
    func updateUIViewController(_ vc: PHPickerViewController, context: Context) {}
    func makeCoordinator() -> Coord { Coord(done: done) }

    final class Coord: NSObject, PHPickerViewControllerDelegate {
        let done: ([Picked], [String]) -> Void
        init(done: @escaping ([Picked], [String]) -> Void) { self.done = done }

        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            picker.dismiss(animated: true)
            if results.isEmpty { return }
            Task {
                var out = [Picked?](repeating: nil, count: results.count), errs: [String] = []
                await withTaskGroup(of: (Int, Picked?, String?).self) { g in
                    for (i, r) in results.enumerated() {
                        g.addTask { do { return (i, try await Coord.load(r), nil) } catch { return (i, nil, error.localizedDescription) } }
                    }
                    for await (i, p, e) in g { out[i] = p; if let e { errs.append(e) } }
                }
                let picked = out.compactMap { $0 }
                await MainActor.run { self.done(picked, errs) }
            }
        }

        static func load(_ r: PHPickerResult) async throws -> Picked {
            let ip = r.itemProvider
            // the asset's own kind first (a .mov stays a .mov, a HEIC stays a HEIC)
            let kinds = ip.registeredTypeIdentifiers.compactMap { UTType($0) }
            let kind = kinds.first(where: { $0.conforms(to: .movie) }) ?? kinds.first(where: { $0.conforms(to: .image) && $0 != .image }) ?? kinds.first ?? .data
            return try await withCheckedThrowingContinuation { cont in
                ip.loadFileRepresentation(forTypeIdentifier: kind.identifier) { url, err in
                    guard let url else { cont.resume(throwing: err ?? APIError(message: "Could not read this item.")); return }
                    // the system's copy lasts only inside this block
                    var name = ip.suggestedName ?? url.deletingPathExtension().lastPathComponent
                    let ext = url.pathExtension.isEmpty ? (kind.preferredFilenameExtension ?? "") : url.pathExtension
                    if !ext.isEmpty && (name as NSString).pathExtension.lowercased() != ext.lowercased() { name += "." + ext }
                    do { cont.resume(returning: try Picked.copy(url, name: name)) } catch { cont.resume(throwing: error) }
                }
            }
        }
    }
}

// Any file from Files (iCloud Drive, On My iPhone, Dropbox…)
struct FilePicker: UIViewControllerRepresentable {
    var done: ([Picked], [String]) -> Void
    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let p = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)
        p.allowsMultipleSelection = true
        p.delegate = context.coordinator
        return p
    }
    func updateUIViewController(_ vc: UIDocumentPickerViewController, context: Context) {}
    func makeCoordinator() -> Coord { Coord(done: done) }
    final class Coord: NSObject, UIDocumentPickerDelegate {
        let done: ([Picked], [String]) -> Void
        init(done: @escaping ([Picked], [String]) -> Void) { self.done = done }
        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            var out: [Picked] = [], errs: [String] = []
            for u in urls { do { out.append(try Picked.copy(u)) } catch { errs.append(error.localizedDescription) } }
            done(out, errs)
        }
    }
}

// The phone's share sheet for a downloaded file (Save to Files elsewhere, AirDrop, another app) or a link
struct ShareSheet: UIViewControllerRepresentable {
    var items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: items, applicationActivities: nil) }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}
