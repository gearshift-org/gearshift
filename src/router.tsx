import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router"
import { AppShell } from "./components/layout/AppShell"

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

const routeTree = rootRoute.addChildren([
  indexRoute,
  projectRoute.addChildren([projectIndexRoute, tabRoute]),
])

// Boot always lands on "/"; AppShell navigates to the stored active project
// once the on-disk state snapshot hydrates (async). Keeps initial render
// non-blocking.
export const router = createRouter({
  routeTree,
  history: createMemoryHistory({ initialEntries: ["/"] }),
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
