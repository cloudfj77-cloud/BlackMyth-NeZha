// Port batch 1: music follows the run (explore → battle → battle2 → victory) and cues fire.
const h = require('./harness.cjs');
const audio = (page) => page.evaluate(() => JSON.parse([...document.querySelectorAll('#game-ui *')].find((e) => e.shadowRoot?.querySelector('[data-ui-part="hud"]'))?.dataset.audio ?? '{}'));
(async () => {
  const r = {};
  const { browser, page, errors } = await h.launch({ lang: 'zh-CN' });
  try {
    await h.open(page, 'http://localhost:4191/?qa=1');
    await h.startPlaying(page);
    await h.wait(800);
    r.canyon = (await audio(page)).music;
    await page.keyboard.press('KeyM');
    await h.wait(300);
    r.muted = (await audio(page)).muted;
    await page.keyboard.press('KeyM');
    await browser.close();
    const b2 = await h.launch({ lang: 'zh-CN' });
    const p2 = b2.page;
    await h.open(p2, 'http://localhost:4191/?qa=1&dev=1&lab=skipintro,phase2');
    await h.startPlaying(p2);
    await h.waitState(p2, (q) => q.fight.stage === 'fight', 8000);
    await h.wait(1500);
    r.fight = (await audio(p2)).music;
    await p2.mouse.down({ button: 'left' }); await p2.mouse.up({ button: 'left' });
    await h.hold(p2, ['Space'], 60);
    await h.wait(3000);
    r.cues = await audio(p2);
    r.errors = [...errors, ...b2.errors];
    await b2.browser.close();
  } catch (e) { r.fail = e.stack; }
  console.log(JSON.stringify(r));
})();
