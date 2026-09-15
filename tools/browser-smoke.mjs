/**
 * Browser smoke test for boot, Practice routing, and sortie outcome policy.
 * Usage: node tools/browser-smoke.mjs
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, resolve } from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { createCareer } from '../js/meta.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
};

function wait(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
      if (pathname === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
      }
      const relative = pathname === '/' ? '/index.html' : pathname;
      const filePath = resolve(root, `.${relative}`);
      if (!filePath.startsWith(root)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const body = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return server;
}

const career = createCareer(4242);
const roster = {
  version: 1,
  activeId: 'browser-smoke',
  slots: [{ id: 'browser-smoke', lastPlayed: Date.now(), career }],
};

const server = startServer();
let browser = null;
try {
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const port = server.address().port;
  browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage({
    viewport: { width: 1024, height: 768, deviceScaleFactor: 1 },
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.evaluateOnNewDocument((savedRoster) => {
    localStorage.setItem('gunship_roster_v1', savedRoster);
  }, JSON.stringify(roster));
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  await wait(2200);

  const stateUrl = `http://127.0.0.1:${port}/js/sim/gameState.js`;
  const contractsUrl = `http://127.0.0.1:${port}/js/contracts.js`;
  const titleBoxes = await page.evaluate(
    async (url) => (await import(url)).titleMenuBoxes,
    stateUrl
  );
  const optionsBox = titleBoxes.find((box) => box.action === 'options');
  assert.ok(optionsBox, 'campaign hub exposes Options');
  assert.ok(
    !titleBoxes.some((box) => box.action === 'install'),
    'install is a hub chip, not a menu row'
  );
  const hubChrome = await page.evaluate(() => ({
    install: !document.getElementById('pwa-install')?.classList.contains('hidden'),
    fullscreen: !document.getElementById('pwa-fullscreen')?.classList.contains('hidden'),
    installLabel: document.getElementById('pwa-install')?.textContent || '',
  }));
  assert.equal(hubChrome.install, true, 'hub shows How to Install chip');
  assert.match(hubChrome.installLabel, /INSTALL/i);
  assert.equal(hubChrome.fullscreen, true, 'hub shows Fullscreen chip');
  const practiceBox = titleBoxes.find((box) => box.sortieMode === 'practice');
  assert.ok(practiceBox, 'campaign hub exposes Practice mode');
  assert.match(practiceBox.sub, /SANDBOX/);
  assert.ok(
    titleBoxes.some((box) => box.target === 'achievements'),
    'campaign hub exposes Achievements'
  );
  await page.mouse.click(practiceBox.x + practiceBox.w / 2, practiceBox.y + practiceBox.h / 2);
  await wait(150);

  const hangarChrome = await page.evaluate(() => ({
    install: !document.getElementById('pwa-install')?.classList.contains('hidden'),
    fullscreen: !document.getElementById('pwa-fullscreen')?.classList.contains('hidden'),
  }));
  assert.equal(hangarChrome.install, false, 'How to Install is hub-only');
  assert.equal(hangarChrome.fullscreen, false, 'Fullscreen chip is hub-only');

  const practiceRoute = await page.evaluate(async (url) => {
    const state = await import(url);
    return {
      mode: state.sortieContext.mode,
      sandbox: Boolean(state.career?.sandbox),
      pilot: state.career?.pilot?.name,
      unlocked: (state.career?.unlocked || []).length,
      contractCount: state.contractBoard.length,
    };
  }, stateUrl);
  assert.equal(practiceRoute.mode, 'practice');
  assert.equal(practiceRoute.sandbox, true, 'Practice swaps in a sandbox career');
  assert.equal(practiceRoute.pilot, 'RANGE PILOT');
  assert.equal(practiceRoute.unlocked, 6, 'Practice hangar has every airframe');

  await page.evaluate(
    async ({ stateUrl: statePath, appUrl }) => {
      const state = await import(statePath);
      const app = await import(appUrl);
      app.switchScreen('contracts');
      return state.contractBoard.length;
    },
    { stateUrl, appUrl: `http://127.0.0.1:${port}/js/app.js` }
  );
  await wait(80);
  const practiceBoard = await page.evaluate(async (url) => {
    const state = await import(url);
    return state.contractBoard.length;
  }, stateUrl);
  assert.equal(practiceBoard, 4, 'Practice operations still uses the normal contract board');

  await page.evaluate(
    async ({ stateUrl: statePath, appUrl }) => {
      const state = await import(statePath);
      const app = await import(appUrl);
      app.switchScreen('briefing', state.contractBoard[0]);
      app.switchScreen('sortie', state.activeContract);
    },
    { stateUrl, appUrl: `http://127.0.0.1:${port}/js/app.js` }
  );
  await wait(300);

  const practiceSortie = await page.evaluate(async (url) => {
    const state = await import(url);
    return { worldSize: state.world?.worldSize, act: state.world?.act };
  }, stateUrl);
  assert.equal(practiceSortie.act, 4, 'Practice uses the late-act roster');
  assert.equal(practiceSortie.worldSize, 21000, 'Practice flies the act 4 map');

  const practiceOutcome = await page.evaluate(
    async ({ stateUrl: statePath, appUrl }) => {
      const state = await import(statePath);
      const app = await import(appUrl);
      const before = JSON.stringify(state.career);
      state.sortieState.status = 'failed';
      state.sortieState.endTimer = 0;
      app.switchScreen('debrief');
      return {
        unchanged: JSON.stringify(state.career) === before,
        committed: state.sortieContext.outcomeCommitted,
        mode: state.sortieContext.mode,
        rewards: [state.sortieXpEarned, state.sortieDollarsEarned],
      };
    },
    { stateUrl, appUrl: `http://127.0.0.1:${port}/js/app.js` }
  );
  assert.equal(
    practiceOutcome.unchanged,
    true,
    'Practice death leaves the campaign career unchanged'
  );
  assert.equal(practiceOutcome.committed, true, 'Practice debrief is idempotently marked complete');
  assert.deepEqual(practiceOutcome.rewards, [0, 0], 'Practice has no persistent rewards');

  const restored = await page.evaluate(
    async ({ stateUrl: statePath, appUrl }) => {
      const app = await import(appUrl);
      const state = await import(statePath);
      app.switchScreen('title');
      return {
        sandbox: Boolean(state.career?.sandbox),
        mode: state.sortieContext.mode,
      };
    },
    { stateUrl, appUrl: `http://127.0.0.1:${port}/js/app.js` }
  );
  assert.equal(restored.sandbox, false, 'leaving Practice restores the campaign career');
  assert.equal(restored.mode, 'campaign');

  const campaignOutcome = await page.evaluate(
    async ({ stateUrl: statePath, appUrl }) => {
      const state = await import(statePath);
      const app = await import(appUrl);
      const c = state.career;
      c.campaign = { act: 3, sortie: 2 };
      c.gunship = 'cobra';
      c.hangar.cobra.engine = 1;
      state.setSortieMode('campaign');
      state.captureSortieSnapshot();
      const oldPilot = c.pilot;
      state.sortieState.status = 'failed';
      state.sortieState.endTimer = 0;
      app.switchScreen('debrief');
      return {
        replacedPilot: state.career.pilot !== oldPilot,
        campaign: state.career.campaign,
        gunship: state.career.gunship,
        engine: state.career.hangar.cobra.engine,
      };
    },
    { stateUrl, appUrl: `http://127.0.0.1:${port}/js/app.js` }
  );
  assert.equal(campaignOutcome.replacedPilot, true, 'Campaign death replaces the pilot');
  assert.deepEqual(campaignOutcome.campaign, { act: 1, sortie: 1 });
  assert.equal(campaignOutcome.gunship, 'cobra', 'Campaign death retains the gunship');
  assert.equal(campaignOutcome.engine, 1, 'Campaign death retains hangar upgrades');

  const strongholdRoute = await page.evaluate(
    async ({ stateUrl: statePath, appUrl, contractsUrl: contractsPath }) => {
      const state = await import(statePath);
      const app = await import(appUrl);
      const contracts = await import(contractsPath);
      state.career.campaign = { act: 4, sortie: 4 };
      state.setSortieMode('campaign');
      const contract = contracts.createContractBoard(808, state.career.campaign)[0];
      app.switchScreen('sortie', contract);
      return {
        stronghold: contract.stronghold,
        finalBoss: contract.bossProfile.final,
        timer: state.sortieState.strongholdTimeRemaining,
        bossSpawned: state.boss.spawned,
        bodyguards: state.boss.bodyguards,
        defenses: state.enemies.filter((enemy) => enemy.strongholdDefense).length,
        targetHidden: !!state.world?.objective?.target?.objectiveHidden,
        intelRequired: state.world?.objective?.intel?.required || 0,
        worldSize: state.world?.worldSize,
      };
    },
    { stateUrl, appUrl: `http://127.0.0.1:${port}/js/app.js`, contractsUrl }
  );
  assert.equal(strongholdRoute.stronghold, true, 'Act 4 sortie 4 routes to a stronghold');
  assert.equal(strongholdRoute.finalBoss, true, 'Act 4 stronghold carries the final boss');
  assert.equal(strongholdRoute.timer, 270, 'stronghold starts its dedicated timer');
  assert.equal(strongholdRoute.worldSize, 21000, 'act 4 stronghold uses the largest map');
  assert.equal(strongholdRoute.bossSpawned, true, 'stronghold commander is present at launch');
  assert.ok(strongholdRoute.bodyguards > 0, 'stronghold commander receives bodyguards');
  assert.equal(strongholdRoute.targetHidden, true, 'stronghold target stays hidden until intel');
  assert.ok(strongholdRoute.intelRequired > 0, 'stronghold still requires intel before the reveal');
  assert.equal(strongholdRoute.defenses, 0, 'stronghold defenses spawn only after the target is revealed');

  assert.deepEqual(errors, [], `browser reported errors: ${errors.join('; ')}`);
  console.log(
    'Browser smoke: splash→hub, Practice route, Practice safety, and campaign KIA policy passed'
  );
} finally {
  if (browser) await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
