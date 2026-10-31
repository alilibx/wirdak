/** A person's number under their name in a list; nothing when it's hidden from the organizer. */
export function PersonPhone({ phone }: { phone: string | null }) {
  if (phone === null) return null;
  return (
    <span className="block text-base font-normal text-ink-soft">
      <span dir="ltr">{phone}</span>
    </span>
  );
}
