import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router"
import { AppShell } from "./components/layout/AppShell"
import { SettingsRoute } from "./routes/settings/SettingsRoute"
import {
  parseSettingsSection,
  type SettingsSection,
} from "./routes/settings/settingsSections"
import { store } from "./lib/store"
import { saveLastLocation } from "./lib/projects"

const rootRoute = createRootRoute({
  component: () => (
    <>
      <AppShell />
      <Outlet />
    </>
  ),
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => null,
})

const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId",
  component: () => <Outlet />,
})

const projectIndexRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/",
  component: () => null,
})

const tabRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "tabs/$tabId",
  component: () => null,
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  validateSearch: (search): { section?: SettingsSection } => ({
    section: parseSettingsSection(search.section),
  }),
  component: SettingsRoute,
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  projectRoute.addChildren([projectIndexRoute, tabRoute]),
  settingsRoute,
])

// Boot always lands on "/"; AppShell navigates to the stored active project
// once the on-disk state snapshot hydrates (async). Keeps initial render
// non-blocking.
export const router = createRouter({
  routeTree,
  history: createMemoryHistory({ initialEntries: ["/"] }),
})

// Memory history resets to "/" on every reload, so persist the resolved
// location once the store is ready and restore it on boot (see AppShell). The
// pre-ready guard avoids writes being clobbered when the snapshot hydrates.
router.subscribe("onResolved", () => {
  if (!store.isReady()) return
  saveLastLocation({
    pathname: router.state.location.pathname,
    search: router.state.location.search as Record<string, unknown>,
  })
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
