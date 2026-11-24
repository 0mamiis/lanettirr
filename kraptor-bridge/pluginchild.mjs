import { pluginStreams } from "./pluginrun.mjs";
process.on("message", async ({ rid, type, id }) => {
	const sink = [];
	const iv = setInterval(() => process.send({ rid, snap: sink }), 700);
	try { await pluginStreams(type, id, sink, (...a) => console.log(...a)); } catch (e) { console.log("child err", e.message); }
	clearInterval(iv);
	process.send({ rid, snap: sink, done: true });
});

