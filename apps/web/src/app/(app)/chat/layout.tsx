import { ConversationList } from '../../../components/chat/conversation-list';

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="py-6 md:py-8">
      <div className="md:grid md:grid-cols-[320px_1fr] md:gap-6 md:items-start">
        <aside className="hidden md:block md:sticky md:top-20">
          <ConversationList />
        </aside>
        <section className="md:min-h-[70vh]">{children}</section>
      </div>
    </div>
  );
}