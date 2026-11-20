// The sender's picture beside a RoarMe notification (Alex, 20 Nov), as Messages and WhatsApp show it.
// roar-push sends mutable-content and sender { id, name, avatar, group }; this extension fetches the picture and turns the
// notification into a Communication Notification (INSendMessageIntent), so iOS draws the round photo with the app's
// small icon on it. With no picture, or if anything fails, the notification shows as it came.
import Intents
import UserNotifications

final class NotificationService: UNNotificationServiceExtension {
    private var handler: ((UNNotificationContent) -> Void)?
    private var original: UNMutableNotificationContent?
    private var done = false

    private func finish(_ content: UNNotificationContent) {
        guard !done, let handler = handler else { return }
        done = true
        handler(content)
    }

    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        handler = contentHandler
        let content = (request.content.mutableCopy() as? UNMutableNotificationContent) ?? UNMutableNotificationContent()
        original = content
        guard let sender = content.userInfo["sender"] as? [String: Any], let id = sender["id"] as? String else { finish(content); return }
        let name = (sender["name"] as? String) ?? content.title
        let group = (sender["group"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        let avatar = (sender["avatar"] as? String).flatMap { $0.isEmpty ? nil : URL(string: $0) }

        let build: (INImage?) -> Void = { [weak self] image in
            guard let self = self else { return }
            let person = INPerson(personHandle: INPersonHandle(value: id, type: .unknown), nameComponents: nil, displayName: name,
                                  image: image, contactIdentifier: nil, customIdentifier: id)
            let me = INPerson(personHandle: INPersonHandle(value: "me", type: .unknown), nameComponents: nil, displayName: nil,
                              image: nil, contactIdentifier: nil, customIdentifier: nil, isMe: true)
            let intent = INSendMessageIntent(recipients: group == nil ? [me] : [me, person], outgoingMessageType: .outgoingMessageText,
                                             content: content.body, speakableGroupName: group.map { INSpeakableString(spokenPhrase: $0) },
                                             conversationIdentifier: content.threadIdentifier, serviceName: nil, sender: person, attachments: nil)
            let interaction = INInteraction(intent: intent, response: nil)
            interaction.direction = .incoming
            interaction.donate(completion: nil)
            // the sender's picture needs iOS 15; older phones keep the notification as it came
            if #available(iOS 15.0, *), let updated = try? content.updating(from: intent) { self.finish(updated) } else { self.finish(content) }
        }
        guard let url = avatar else { build(nil); return }
        let task = URLSession.shared.dataTask(with: url) { data, response, _ in
            let ok = (response as? HTTPURLResponse).map { (200..<300).contains($0.statusCode) } ?? false
            build(ok ? data.map { INImage(imageData: $0) } : nil)
        }
        task.resume()
    }

    override func serviceExtensionTimeWillExpire() {
        if let content = original { finish(content) }
    }
}
