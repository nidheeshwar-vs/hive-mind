// Lets views trigger a re-render without importing the router (avoids circular imports).
export const nav = { reload: () => {}, go: h => { location.hash = h; } };
