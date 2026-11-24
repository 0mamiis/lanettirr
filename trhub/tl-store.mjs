// Her torrent parcasini ayri kucuk dosyaya yazar: diskte sadece gercekten inen parcalar yer tutar
// (varsayilan depo dosyayi tam boyutta ayirir ve dev torrentlerde diski doldurur).
import fs from 'node:fs';
import path from 'node:path';

export function makePieceStore(root) {
  return class PieceStore {
    constructor(chunkLength, opts = {}) {
      this.chunkLength = Number(chunkLength);
      this.length = Number(opts.length) || Infinity;
      if (this.length !== Infinity) { this.lastChunkLength = (this.length % this.chunkLength) || this.chunkLength; this.lastChunkIndex = Math.ceil(this.length / this.chunkLength) - 1; }
      const id = (opts.torrent && opts.torrent.infoHash) || String(opts.name || 'x').replace(/[^\w.-]+/g, '_');
      this.dir = path.join(root, id);
      fs.mkdirSync(this.dir, { recursive: true });
      this.closed = false;
    }
    put(index, buf, opts, cb) {
      if (typeof opts === 'function') cb = opts;
      cb = cb || (() => {});
      if (this.closed) return queueMicrotask(() => cb(new Error('Storage is closed')));
      const last = index === this.lastChunkIndex;
      if (last && buf.length !== this.lastChunkLength) return queueMicrotask(() => cb(new Error('Last chunk length must be ' + this.lastChunkLength)));
      if (!last && buf.length !== this.chunkLength) return queueMicrotask(() => cb(new Error('Chunk length must be ' + this.chunkLength)));
      fs.writeFile(path.join(this.dir, String(index)), buf, (e) => cb(e || null));
    }
    get(index, opts, cb) {
      if (typeof opts === 'function') { cb = opts; opts = null; }
      cb = cb || (() => {});
      if (this.closed) return queueMicrotask(() => cb(new Error('Storage is closed')));
      fs.readFile(path.join(this.dir, String(index)), (e, buf) => {
        if (e) { const err = new Error('Chunk not found'); err.notFound = true; return cb(err); }
        const o = (opts && opts.offset) || 0, len = (opts && opts.length) || (buf.length - o);
        cb(null, (o !== 0 || len !== buf.length) ? buf.subarray(o, o + len) : buf);
      });
    }
    close(cb) { this.closed = true; (cb || (() => {}))(null); }
    destroy(cb) { this.closed = true; fs.rm(this.dir, { recursive: true, force: true }, () => (cb || (() => {}))(null)); }
  };
}
