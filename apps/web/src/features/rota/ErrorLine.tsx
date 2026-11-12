/** The one line of trouble under a form or a sheet's actions; nothing while there is none. */
export function ErrorLine({ error }: { error: string | null }) {
  if (error === null) return null;
  return (
    <p role="alert" className="mt-3 font-medium text-danger">
      {error}
    </p>
  );
}
