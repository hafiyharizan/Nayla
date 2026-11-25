/* Most tests are about a phone that is already in use, so they start past the
 * first-run setup screen. This marks every new page in the context as set up —
 * but only when it has no settings yet, so a test that seeds its own wins.
 * setup.test.mjs covers the screen itself and does not use this. */
export async function skipSetup(ctx) {
  await ctx.addInitScript(() => {
    try {
      if (!localStorage.getItem('nayla.settings.v1')) {
        localStorage.setItem('nayla.settings.v1', JSON.stringify({ setupDone: true }));
      }
    } catch {}
  });
}
