import './pages.css'

/** What an address the frontend has no page for shows, inside the layout. */
export function UnknownPage() {
  return (
    <section className="page__notice">
      <h1 className="page__notice-title">This page does not exist</h1>
      <p className="page__note">Its address may be mistyped. The navigation leads to every page.</p>
    </section>
  )
}
