import { chromium } from "playwright-core";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
console.log("chromium", browser.version());
const page = await browser.newPage();
await page.goto("about:blank");
const res = await page.evaluate(async () => {
  const out = { offline: {}, live: {} };
  for (const r of [8000, 44100, 48000, 96000, 192000, 384000, 768000]) {
    try {
      const ctx = new OfflineAudioContext(1, 4800, r);
      const osc = ctx.createOscillator(); osc.frequency.value = 1000; osc.connect(ctx.destination); osc.start();
      const buf = await ctx.startRendering();
      const d = buf.getChannelData(0); let zc = 0;
      for (let i = 1; i < d.length; i++) if (d[i-1] < 0 && d[i] >= 0) zc++;
      out.offline[r] = { ctxRate: ctx.sampleRate, bufRate: buf.sampleRate, zc, seconds: d.length / r };
    } catch (e) { out.offline[r] = { error: String(e) }; }
  }
  for (const r of [48000, 96000, 192000, undefined]) {
    try {
      const ctx = new AudioContext(r ? { sampleRate: r, latencyHint: "interactive" } : { latencyHint: "interactive" });
      await ctx.resume().catch(e => out.live.resumeErr = String(e));
      await new Promise(res => setTimeout(res, 1500));
      out.live[r ?? "default"] = { state: ctx.state, sampleRate: ctx.sampleRate, baseLatency: ctx.baseLatency, outputLatency: ctx.outputLatency, currentTime: ctx.currentTime, hasRenderCapacity: typeof ctx.renderCapacity };
      await ctx.close();
    } catch (e) { out.live[r ?? "default"] = { error: String(e) }; }
  }
  return out;
});
console.log(JSON.stringify(res, null, 1));
await browser.close();
