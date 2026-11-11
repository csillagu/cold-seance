import './pages.css'

/** The page the frontend opens on, inside the layout: it points to the navigation. */
export function StartPage() {
  return (
    <section>
      <h1 className="page__title">cold-seance</h1>
      <p className="page__note">Open a project from the navigation.</p>
    </section>
  )
}
