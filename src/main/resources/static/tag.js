/* Local stand-in for the one-script WebMCP tag used by the demo. */
(() => {
  const state = { manifest: null, route: location.hash || "#/fleet" };
  async function refresh() {
    try {
      state.manifest = await fetch("/api/platform/manifest").then((r) => r.json());
      window.dispatchEvent(new CustomEvent("webmcp:ready", { detail: state.manifest }));
    } catch (error) {
      console.warn("WebMCP demo tag could not reach its local manifest", error);
    }
    return state.manifest;
  }
  window.WebMCPTag = {
    version: "0.1-demo",
    getContext: () => ({ route: state.route, vin: state.route.match(/\/fleet\/([^/?#]+)/)?.[1] || null }),
    getManifest: () => state.manifest,
    setRoute: (route) => { state.route = route; window.dispatchEvent(new CustomEvent("webmcp:context", { detail: window.WebMCPTag.getContext() })); },
    refresh
  };
  refresh();
})();
