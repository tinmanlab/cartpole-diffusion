// Regression test for F1: applyGuidePrefix() must stop the moment the plant crosses the
// same physical termination gate the live step() loop uses (|theta|>18deg or |x|>2.4m, or
// a non-finite state), instead of blindly finishing all 4 actions and letting
// exitGuide()/restartGuideCycle()/Next replan from an already-fallen plant.
//
// This drives the REAL production functions (physics/isFallen/applyAction/step/
// applyGuidePrefix/reset) loaded from the actual index.html inline script, with the actual
// bundled model weights, inside a real Chromium page, through the real UI controls. The
// only thing this test injects is the plant's *starting* state, via a labelled
// SYNTHETIC_FIXTURE substitution of the one-shot bootstrap line
// `state=resetState();renderSim();...` -- resetState() itself is left untouched (so a real
// click on the explicit Reset button still recovers the normal 5deg start), no other line
// of index.html is touched, and no new setter API is added to the production page.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// TERMINAL_GATE_ROOT lets this exact same suite be pointed at a materialized baseline
// checkout (e.g. `git show <pre-fix-ref>:file > tmpdir/file`) to demonstrate it rejects the
// old F1 behavior, without ever checking out that ref into this worktree. Defaults to the
// real repo, which is what CI always runs.
const root = process.env.TERMINAL_GATE_ROOT ? path.resolve(process.env.TERMINAL_GATE_ROOT) : path.resolve(__dirname, "..");
const PORT = 8241;
const outDir = path.resolve(root, "qa-output/semantic-fix");
const shotDir = path.join(outDir, "screenshots");
fs.mkdirSync(shotDir, { recursive: true });

// theta/thetaDot and x/xDot pairs picked (via a one-off scan using the real bundled model
// plus the real ddim/physics arithmetic -- see /tmp/search_fixtures.cjs, not shipped) so the
// guide's 4-action prefix halts at exactly tick 1/2/3/4 for the DEFAULT noiseSeed=11 plan.
// angleTick1/x2.39 reproduce the exact states from the F1 finding text.
const FIXTURES = {
  normal: null, // no bootstrap override: unmodified default 5deg start
  angleSafe: { x: 0, xDot: 0, theta: "10*Math.PI/180", thetaDot: 0 }, // negative control: survives all 4
  posSafe: { x: 2.0, xDot: 0, theta: 0, thetaDot: 0 }, // negative control: survives all 4
  angleTick1: { x: 0, xDot: 0, theta: "17.9*Math.PI/180", thetaDot: 1 },
  angleTick2: { x: 0, xDot: 0, theta: "16.5*Math.PI/180", thetaDot: 1 },
  posTick3: { x: 2.34, xDot: 1, theta: 0, thetaDot: 0 },
  posTick4: { x: 2.3, xDot: 1, theta: 0, thetaDot: 0 },
  alreadyInvalidAngle: { x: 0, xDot: 0, theta: "20*Math.PI/180", thetaDot: 0 },
  alreadyInvalidX: { x: 2.5, xDot: 0, theta: 0, thetaDot: 0 },
  nonFinite: { x: "NaN", xDot: 0, theta: 0, thetaDot: 0 },
};
// Ticks-to-fall required per fixture, asserted literally (not just ">0").
const EXPECTED_TICK = { angleTick1: 1, angleTick2: 2, posTick3: 3, posTick4: 4 };

const BOOTSTRAP_SRC = 'state=resetState();renderSim();DiffusionViz.renderInspector(E("inspector"),null);';
function bootstrapSource(name) {
  const f = FIXTURES[name];
  if (f === undefined) throw new Error("unknown fixture " + name);
  if (f === null) return null;
  // SYNTHETIC_FIXTURE: labelled override of only the one-shot bootstrap state assignment,
  // plus pausing the live loop before it can auto-advance. resetState() itself (used by the
  // real Reset button) is never touched, so explicit Reset still restores the normal 5deg
  // start. No other branch, asset, or math changes.
  return (
    "/*SYNTHETIC_FIXTURE:" + name + "*/state={x:" + f.x + ",xDot:" + f.xDot + ",theta:" + f.theta +
    ",thetaDot:" + f.thetaDot + "};running=false;renderSim();DiffusionViz.renderInspector(E(\"inspector\"),null);"
  );
}

function startServer() {
  const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.ok(indexHtml.includes(BOOTSTRAP_SRC), "bootstrap line shape changed; update fixture substitution");
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, "http://localhost");
      const pathname = decodeURIComponent(u.pathname);
      if (pathname === "/" || pathname === "/index.html") {
        const fixture = u.searchParams.get("fixture");
        const sub = bootstrapSource(fixture);
        const html = sub ? indexHtml.replace(BOOTSTRAP_SRC, sub) : indexHtml;
        res.setHeader("content-type", "text/html");
        return res.end(html);
      }
      const file = path.join(root, pathname);
      fs.readFile(file, (e, d) => {
        if (e) { res.statusCode = 404; return res.end("not found"); }
        const type = file.endsWith(".js") ? "application/javascript" : file.endsWith(".json") ? "application/json" : "application/octet-stream";
        res.setHeader("content-type", type);
        res.end(d);
      });
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

const report = { generatedAt: new Date().toISOString(), checks: [], errors: [] };
function check(name, cond, detail) {
  try {
    assert.ok(cond, name);
    report.checks.push({ name, ok: true });
  } catch (e) {
    report.errors.push({ name, ok: false, detail: safeDetail(detail) });
    throw e;
  }
}
function safeDetail(d) { try { return JSON.parse(JSON.stringify(d ?? null)); } catch { return String(d); } }

async function waitLearned(page) {
  await page.waitForFunction(() => window.__qaDiffusion && window.__qaDiffusion.getModel() != null, null, { timeout: 15000 });
}
const qa = (page, fn, ...args) => page.evaluate(([fn, ...a]) => window.__qaDiffusion[fn](...a), [fn, ...args]);

// Explicit negative-control event delivery: only used to prove a *disabled* control does
// nothing when its handler still somehow ran, never to force-enable or bypass the real
// disabled attribute. The main product assertion is always `isDisabled() === true` first.
async function dispatchClickOnDisabled(page, selector) {
  const disabled = await page.locator(selector).isDisabled();
  assert.ok(disabled, selector + " must actually be disabled before the negative-control dispatch");
  await page.locator(selector).dispatchEvent("click");
}

async function openPage(browser, fixture, viewport) {
  const page = await browser.newPage({ viewport: viewport || { width: 1024, height: 900 }, reducedMotion: "reduce" });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/index.html?fixture=${fixture}`, { waitUntil: "domcontentloaded" });
  await waitLearned(page);
  return { page, pageErrors };
}

async function driveGuideToApply(page) {
  await page.locator("#guideBtn").click();
  for (let i = 0; i < 3; i++) { await page.locator("#guideNext").click(); await page.waitForTimeout(20); }
  // guideStep now 3 (final plan). One more Next triggers applyGuidePrefix() (guideStep -> 4).
  await page.locator("#guideNext").click();
  await page.waitForTimeout(20);
}

async function resultPanelData(page) {
  return page.evaluate(() => ({
    loopBackTitle: document.querySelector("#loopBackTitle")?.textContent,
    loopBackDesc: document.querySelector("#loopBackDesc")?.textContent,
    nestedResultSpan: document.querySelector("#reobserveCompare .reobserve-title span")?.textContent,
  }));
}

async function execPanelData(page) {
  return page.evaluate(() => {
    const now = document.querySelector('[data-qa="current-force"]');
    const horizon = document.querySelector('[data-qa="horizon"]');
    const actions = [...document.querySelectorAll('[data-qa="exec-action"]')].map((el) => el.className);
    return {
      nowTerminal: now?.dataset.terminal,
      nowAppliedCount: now?.dataset.appliedCount,
      horizonTerminal: horizon?.dataset.terminal,
      horizonAppliedCount: horizon?.dataset.appliedCount,
      actions,
      guideIdentity: document.querySelector("#guideIdentity")?.textContent,
      guideExplain: document.querySelector("#guideExplain")?.textContent,
      guideNextDisabled: document.querySelector("#guideNext")?.disabled,
    };
  });
}

// Real, non-hand-rolled oracle: replays a captured (plan, initial state) pair through the
// PRODUCTION physics()/isFallen() functions exposed read-only on window.__qaDiffusion --
// never a reimplemented integrator -- to find the tick at which the shared gate must fire.
async function expectedFailTick(page, plan, initState, push) {
  return page.evaluate(([plan, initState, push]) => {
    const q = window.__qaDiffusion;
    let s = { x: initState[0], xDot: initState[1], theta: initState[2], thetaDot: initState[3] };
    if (q.isFallen(s)) return { tick: 0, state: [s.x, s.xDot, s.theta, s.thetaDot] };
    for (let i = 0; i < 4; i++) {
      s = q.physics(s, plan[i] * q.MAXF, push || 0);
      if (q.isFallen(s)) return { tick: i + 1, state: [s.x, s.xDot, s.theta, s.thetaDot] };
    }
    return { tick: -1, state: [s.x, s.xDot, s.theta, s.thetaDot] };
  }, [plan, initState, push]);
}

async function run() {
  const server = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });

    // --- 1) Normal 4-step guide apply is unaffected by the fix (regression). ---
    {
      const { page, pageErrors } = await openPage(browser, "normal");
      await driveGuideToApply(page);
      const status = await qa(page, "getStatus");
      const cursor = await qa(page, "getPlanCursor");
      const d = await execPanelData(page);
      check("normal: status stays balancing", status === "balancing", status);
      check("normal: all 4 actions applied", cursor === 4, cursor);
      check("normal: exec panel not terminal", d.nowTerminal === "false" && d.horizonTerminal === "false", d);
      check("normal: 3 done + 1 active exec cards", d.actions.filter((c) => c.includes(" done")).length === 3 && d.actions.filter((c) => c.includes(" active")).length === 1, d.actions);
      const rd = await resultPanelData(page);
      check("normal: outer loop-back caption still claims a fresh 16-action replan (unchanged)", rd.loopBackTitle === "4 · 다시 관측 → 새 계획" && rd.loopBackDesc.includes("새로운 16-action plan을 생성합니다"), rd);
      check("normal: no page errors", pageErrors.length === 0, pageErrors);
      await page.close();
    }

    // --- 2) Negative-control boundary pair: starts near, but on the safe side of, each
    //        threshold and must survive the full 4-action prefix without going terminal. ---
    for (const fixture of ["angleSafe", "posSafe"]) {
      const { page, pageErrors } = await openPage(browser, fixture);
      await driveGuideToApply(page);
      const status = await qa(page, "getStatus");
      const cursor = await qa(page, "getPlanCursor");
      check(fixture + ": safe start does not go terminal", status === "balancing", status);
      check(fixture + ": safe start applies all 4 actions", cursor === 4, cursor);
      check(fixture + ": no page errors", pageErrors.length === 0, pageErrors);
      await page.close();
    }

    // --- 3) Guide path halts at the exact tick a real physics()/isFallen() replay of its
    //        OWN captured plan predicts, for shortened prefixes of every length 1..4. ---
    for (const fixture of ["angleTick1", "angleTick2", "posTick3", "posTick4"]) {
      const { page, pageErrors } = await openPage(browser, fixture);
      await page.locator("#guideBtn").click(); // startGuide() -> makePlan(): this is THE plan
      const plan = await qa(page, "getPlan");
      const initState = await qa(page, "getState"); // still the fixture's raw starting state
      const expected = await expectedFailTick(page, plan, initState, 0);
      check(fixture + ": expected fail tick matches the fixture's designed tick", expected.tick === EXPECTED_TICK[fixture], { expected, want: EXPECTED_TICK[fixture] });

      for (let i = 0; i < 3; i++) { await page.locator("#guideNext").click(); await page.waitForTimeout(20); }
      await page.locator("#guideNext").click(); // guideStep -> 4, triggers applyGuidePrefix()
      await page.waitForTimeout(20);

      const guideStatus = await qa(page, "getStatus");
      const guideCursor = await qa(page, "getPlanCursor");
      const guideState = await qa(page, "getState");
      const guideLastIndex = await qa(page, "getLastAppliedActionIndex");
      const guideLastForce = await qa(page, "getLastAppliedForce");
      const d = await execPanelData(page);
      check(fixture + ": guide reaches fell status", guideStatus === "fell", guideStatus);
      check(fixture + ": guide applied exactly the expected number of actions (" + expected.tick + ")", guideCursor === expected.tick, { guideCursor, expected });
      check(fixture + ": guide's real final state matches the physics()/isFallen() replay exactly", JSON.stringify(guideState) === JSON.stringify(expected.state), { guideState, expected });
      check(fixture + ": guide's last-applied index is applied-count - 1", guideLastIndex === expected.tick - 1, { guideLastIndex, expected });
      check(fixture + ": last applied force is non-zero (not the post-terminal reset value)", guideLastForce !== 0, guideLastForce);
      check(fixture + ": exec panel reports terminal=true", d.nowTerminal === "true" && d.horizonTerminal === "true", d);
      check(fixture + ": exec panel applied-count matches actual executed count", Number(d.nowAppliedCount) === expected.tick, d);
      check(fixture + ": exactly expected 'done'+'active' cards, rest 'skipped'", d.actions.filter((c) => c.includes(" done") || c.includes(" active")).length === expected.tick && d.actions.filter((c) => c.includes(" skipped")).length === 4 - expected.tick, d.actions);
      check(fixture + ": guideIdentity reports the shortened count, not a hardcoded a[0]~a[3]", !d.guideIdentity.includes("a[0]~a[3] 이미 실행됨"), d.guideIdentity);
      check(fixture + ": guideExplain does not claim a full 4-action/0.08s execution", !d.guideExplain.includes("a[0]~a[3] 네 force만 0.08 s 실행했습니다"), d.guideExplain);
      check(fixture + ": Next is disabled once terminal (no silent replan)", d.guideNextDisabled === true, d.guideNextDisabled);

      if (fixture === "angleTick1") {
        await page.screenshot({ path: path.join(shotDir, "terminal-action-1440.png") });
      }

      // Visiting the stage-nav Result tab after an early terminal must be pure inspection:
      // no additional ticks/state/plan/force change, and BOTH the outer static loop-back
      // card and the nested reobserve panel must agree there is no replan.
      const beforeResult = { state: guideState, cursor: guideCursor, plan, lastIndex: guideLastIndex, lastForce: guideLastForce };
      check(fixture + ": stageResultBtn is enabled after an early-terminal apply", !(await page.locator("#stageResultBtn").isDisabled()), null);
      await page.locator("#stageResultBtn").click();
      await page.waitForTimeout(20);
      const afterResult = {
        state: await qa(page, "getState"), cursor: await qa(page, "getPlanCursor"), plan: await qa(page, "getPlan"),
        lastIndex: await qa(page, "getLastAppliedActionIndex"), lastForce: await qa(page, "getLastAppliedForce"),
      };
      check(fixture + ": viewing Result after early terminal applies zero additional ticks/state/plan/force change", JSON.stringify(beforeResult) === JSON.stringify(afterResult), { beforeResult, afterResult });
      const rd = await resultPanelData(page);
      check(fixture + ": outer loop-back caption reports no-replan once terminal", rd.loopBackTitle === "종료 결과 · 재계획 중지" && !rd.loopBackDesc.includes("새로운 16-action plan을 생성합니다."), rd);
      check(fixture + ": nested reobserve panel also reports no-replan once terminal", !!rd.nestedResultSpan && rd.nestedResultSpan.includes("재계획하지 않습니다"), rd);

      if (fixture === "angleTick1") {
        await page.screenshot({ path: path.join(shotDir, "terminal-result-1440.png") });
      }

      // Gate: Next/exitGuide-replan must not resurrect or re-step the plant.
      await dispatchClickOnDisabled(page, "#guideNext");
      await page.waitForTimeout(20);
      check(fixture + ": Next after terminal is a no-op (still fell, same state)", (await qa(page, "getStatus")) === "fell" && JSON.stringify(await qa(page, "getState")) === JSON.stringify(guideState), null);

      await page.locator("#guideExit").click();
      await page.waitForTimeout(20);
      check(fixture + ": exitGuide after terminal does not replan (status stays fell)", (await qa(page, "getStatus")) === "fell", null);
      const postExitData = await execPanelData(page);
      check(fixture + ": exec panel keeps terminal metadata after guide exit (guideMode=false)", postExitData.nowTerminal === "true" && postExitData.horizonTerminal === "true", postExitData);
      check(fixture + ": Run button relabels to explicit Reset instead of hidden restart", (await page.locator("#runBtn").textContent()) === "Reset", null);
      check(fixture + ": guideBtn disabled post-exit until Reset", await page.locator("#guideBtn").isDisabled(), null);

      if (fixture === "angleTick1") {
        await page.screenshot({ path: path.join(shotDir, "result-after-exit-1440.png") });
      }

      // Explicit Reset recovers cleanly and restores the REAL default (unmodified resetState()).
      await page.locator("#resetBtn").click();
      await page.waitForTimeout(20);
      const afterReset = await qa(page, "getState");
      check(fixture + ": explicit Reset clears fell status", (await qa(page, "getStatus")) === "balancing", null);
      check(fixture + ": explicit Reset restores the real default 5deg start (resetState() untouched)", Math.abs(afterReset[2] - 5 * Math.PI / 180) < 1e-9 && afterReset[0] === 0, afterReset);
      check(fixture + ": guideBtn re-enabled after Reset", !(await page.locator("#guideBtn").isDisabled()), null);

      if (fixture === "angleTick1") {
        await page.screenshot({ path: path.join(shotDir, "after-reset-1440.png") });
      }
      check(fixture + ": no page errors for this fixture", pageErrors.length === 0, pageErrors);
      await page.close();
    }

    // --- 4) Already-invalid/non-finite starting state: the pre-state guard fires before any
    //        tick, zero actions ever applied, and guide entry is blocked from the start. ---
    for (const fixture of ["alreadyInvalidAngle", "alreadyInvalidX", "nonFinite"]) {
      const { page, pageErrors } = await openPage(browser, fixture);
      const status = await qa(page, "getStatus");
      const plan = await qa(page, "getPlan");
      const cursor = await qa(page, "getPlanCursor");
      const reason = await qa(page, "getTerminalReason");
      check(fixture + ": status is fell immediately (pre-state guard)", status === "fell", status);
      check(fixture + ": no plan was ever produced and no ticks were ever applied", plan.length === 0 && cursor === 0, { planLength: plan.length, cursor });
      check(fixture + ": terminal reason is reported (invalid vs angle/position, not a generic label)", reason === "invalid" || reason === "angle" || reason === "position", reason);
      if (fixture === "nonFinite") check(fixture + ": non-finite state is reported as 'invalid', not a false angle/position claim", reason === "invalid", reason);
      check(fixture + ": guideBtn disabled from the start", await page.locator("#guideBtn").isDisabled(), null);
      check(fixture + ": no page errors even for a non-finite/out-of-range start", pageErrors.length === 0, pageErrors);
      await page.close();
    }

    // --- 5) Double-apply guard: a disabled Next dispatched twice must not double-step. ---
    {
      const { page } = await openPage(browser, "angleTick1");
      await driveGuideToApply(page);
      const stateAfterFirst = await qa(page, "getState");
      await dispatchClickOnDisabled(page, "#guideNext");
      await page.waitForTimeout(20);
      await dispatchClickOnDisabled(page, "#guideNext");
      await page.waitForTimeout(20);
      const stateAfterRepeats = await qa(page, "getState");
      check("double-apply: repeated disabled-Next dispatch after terminal never re-steps physics", JSON.stringify(stateAfterFirst) === JSON.stringify(stateAfterRepeats), { stateAfterFirst, stateAfterRepeats });
      await page.close();
    }

    // --- 6) Viewport sweep: terminal-shortened prefix renders sanely at narrow/wide widths,
    //        through the terminal-action view, the actual Result tab, and the post-exit view. ---
    for (const width of [390, 1440]) {
      const { page } = await openPage(browser, "angleTick1", { width, height: 900 });
      await driveGuideToApply(page);
      let overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
      let d = await execPanelData(page);
      check(width + "px: no horizontal overflow with terminal exec panel", !overflow, null);
      check(width + "px: terminal exec panel still renders 4 action cards", d.actions.length === 4, d.actions);
      await page.screenshot({ path: path.join(shotDir, "terminal-action-" + width + ".png") });

      await page.locator("#stageResultBtn").click();
      await page.waitForTimeout(20);
      overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
      const rd = await resultPanelData(page);
      check(width + "px: no horizontal overflow on the actual Result tab", !overflow, null);
      check(width + "px: Result tab reports no-replan (outer + nested)", rd.loopBackTitle === "종료 결과 · 재계획 중지" && !!rd.nestedResultSpan && rd.nestedResultSpan.includes("재계획하지 않습니다"), rd);
      await page.screenshot({ path: path.join(shotDir, "terminal-result-" + width + ".png") });

      await page.locator("#guideExit").click();
      await page.waitForTimeout(20);
      overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
      check(width + "px: no horizontal overflow on the post-exit Result view", !overflow, null);
      await page.screenshot({ path: path.join(shotDir, "result-after-exit-" + width + ".png") });

      await page.locator("#resetBtn").click();
      await page.waitForTimeout(20);
      overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
      check(width + "px: no horizontal overflow after Reset", !overflow, null);
      await page.screenshot({ path: path.join(shotDir, "after-reset-" + width + ".png") });
      await page.close();
    }

    console.log("TERMINAL_GATE_CHECK_OK checks=" + report.checks.length);
    fs.writeFileSync(path.join(outDir, "terminal_gate_check.json"), JSON.stringify(report, null, 2));
    await browser.close();
    server.close(() => process.exit(0));
  } catch (e) {
    console.error(e);
    fs.writeFileSync(path.join(outDir, "terminal_gate_check.json"), JSON.stringify(report, null, 2));
    if (browser) await browser.close();
    server.close(() => process.exit(1));
  }
}

run();
