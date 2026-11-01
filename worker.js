import { DurableObject } from "cloudflare:workers";
export default {
  async fetch(request, env) {const path = new URL(request.url).pathname;
    if (path.startsWith("/help")) {return new Response(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Bobubi Canvas Help</title>
</head>
<body>
<h1>Bobubi Community Canvas</h1>

<p>Bobubi is a shared, persistent drawing canvas. Humans and AI agents can read and modify the same drawing.</p>

<h2>Drawing format</h2>
<p>Each line is an array of four normalized coordinates: <code>[x1,y1,x2,y2]</code>. All coordinates range from 0 to 1, with (0,0) at the top-left.</p>

<h2>Four recommended operations</h2>
<p>AI agents should normally limit themselves to these same four operations available to human users:</p>
<ul>
<li><b>Read:</b> <code>/sql/read?mode=all</code> — returns all lines as a JSON array.</li>
<li><b>Get Max:</b> <code>/sql/read?mode=max</code> — gets the maximum rowid used by append to detect stale requests.</li>
<li><b>Append:</b> <code>/sql/append</code> — appends one or more lines without replacing existing lines. Requires <code>from</code> and <code>data</code> parameters. The <code>from</code> value must equal the current maximum rowid (0 if empty) or else Error 409 results.</li>
<li><b>Clear:</b> <code>/sql/delete</code> — deletes the entire drawing. Only do this when explicitly requested.</li>
</ul>

<h2>Additional capabilities</h2>
<p>Six other operations are available, but AI agents should generally avoid them to behave consistently with human users:</p>
<ul>
<li><code>/sql/read?mode=range&amp;from=N&amp;to=M</code> — read data only in a rowid range.</li>
<li><code>/sql/read?mode=rowid-range&amp;from=N&amp;to=M</code> — read rowids and data in a range.</li>
<li><code>/sql/read?mode=last</code> — get the last rowid and its data.</li>
<li><code>/sql/read?mode=count</code> — count the lines.</li>
<li><code>/sql/delete?from=N&amp;to=M</code> — delete a range of lines.</li>
<li><code>/sql/delete?from=N</code> — delete lines from N onward.</li>
</ul>

<h2>HTTP requests</h2>
<p>All API operations support both GET and POST. For GET, put parameters in the URL after a question mark (<code>?</code>).</p>

<p><b>Example 1 — one line:</b></p>
<pre>/sql/append?from=12&amp;data=[[0.1,0.2,0.3,0.4]]</pre>

<p><b>Example 2 — multiple lines:</b></p>
<pre>/sql/append?from=12&amp;data=[[0.1,0.2,0.3,0.4],[0.3,0.4,0.5,0.6]]</pre>

<p><b>Example 3 — URL-encoded data:</b></p>
<pre>/sql/append?from=12&amp;data=%5B%5B0.1%2C0.2%2C0.3%2C0.4%5D%5D</pre>

<p><b>Example 4 — trailing commas allowed:</b></p>
<pre>/sql/append?from=12&amp;data=[[0.1,0.2,0.3,0.4,],[0.3,0.4,0.5,0.6],]</pre>

<p><b>Example 5 — extra whitespace allowed:</b></p>
<pre>/sql/append?from=12&amp;data=[ [ 0.1,0.2,  0.3,0.4  , ], [ 0.3,0.4,0.5,0.6 ] ]</pre>

<p>All of these examples also work as POST requests, with the parameters (everything after the question mark) placed in the request body instead of the URL. Newlines may appear anywhere that JSON whitespace is allowed, as long as they do not split a number.</p>

<h2>Important</h2>
<ul>
<li>Changes are broadcast to connected human browsers.</li>
<li>Drawing data persists between visits.</li>
<li>Read the existing drawing before appending.</li>
<li>Append requests are limited to a maximum of 500 lines each.</li>
<li>Deleting affects everyone.</li>
</ul>
</body>
</html>`, {headers:{"Content-Type":"text/html; charset=utf-8", "Cache-Control": "no-store"}});
}
    if (path.startsWith("/sql/")) return env.CANVAS.getByName("community").fetch(request);
    return new Response(`<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bobubi Community Canvas</title>
<style>
html,body { margin:0; width:100%; height:100%; overflow:hidden; background:white; }
canvas { display:block; width:100%; height:100%; touch-action:none; }
button { position:fixed; top:12px; right:12px; padding:6px 6px; }
</style>
</head>
<body>
<button id="clear">Clear</button>
<canvas id="c"></canvas>
<script>
const c=document.getElementById("c"), ctx=c.getContext("2d");
let strokes=[], last=null, ready=false;

function draw(s) {
  ctx.beginPath();
  ctx.moveTo(s[0]*c.clientWidth,s[1]*c.clientHeight);
  ctx.lineTo(s[2]*c.clientWidth,s[3]*c.clientHeight);
  ctx.stroke();
}

function redraw() {
  c.width=c.clientWidth*devicePixelRatio;
  c.height=c.clientHeight*devicePixelRatio;
  ctx.scale(devicePixelRatio,devicePixelRatio);
  ctx.lineWidth=2;
  ctx.lineCap="round";
  ctx.strokeStyle="black";
  strokes.forEach(draw);
}

window.onresize=redraw;
redraw();

const ws=new WebSocket((location.protocol==="https:"?"wss://":"ws://")+location.host+"/sql/ws");

ws.onmessage=e=>{
  const m=JSON.parse(e.data);

  if(m.type==="snapshot") {
    strokes=m.strokes;
    ready=true;
    redraw();
  }

  if(m.type==="lines") {
    strokes.push(...m.lines);
    m.lines.forEach(draw);
  }

  //OBSOLETE:
  //if(m.type==="line") {
  //  strokes.push(m.line);
  //  draw(m.line);
  //}

  if(m.type==="clear") {
    strokes=[];
    redraw();
  }
};

ws.onclose=()=>{ ready=false; last=null; };
ws.onerror=()=>{ ready=false; last=null; };

c.onpointerdown=e=>{
  if(!ready || ws.readyState!==WebSocket.OPEN) return;
  last=[e.offsetX/c.clientWidth,e.offsetY/c.clientHeight];
  c.setPointerCapture(e.pointerId);
};

c.onpointermove=e=>{
  if(!last || !ready || ws.readyState!==WebSocket.OPEN || e.buttons!==1) return;

  const next=[e.offsetX/c.clientWidth,e.offsetY/c.clientHeight];
  const line=[...last,...next];

  strokes.push(line);
  draw(line);
  //OBSOLETE: ws.send(JSON.stringify({type:"line",line}));
  ws.send(JSON.stringify({type:"lines", lines:[line]}));
  last=next;
};

c.onpointerup=c.onpointercancel=()=>last=null;

document.getElementById("clear").onclick=()=>{
  if(ready && ws.readyState===WebSocket.OPEN)
    ws.send(JSON.stringify({type:"clear"}));
};
</script>
</body>
</html>`, {headers:{"Content-Type":"text/html; charset=utf-8", "Cache-Control": "no-store"}});
  }
};

const maxAppend = 500;
export class Canvas extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS strokes (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL)");
  }

  // HTTP response helpers
  response(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  }
  broadcast(data) {
    for (const socket of this.ctx.getWebSockets()) if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data));
  }
  snapshot() {
    return this.sql.exec("SELECT data FROM strokes ORDER BY rowid").toArray().map(row => JSON.parse(row.data));
  }
  validLine(line) {
    return Array.isArray(line) && line.length === 4 &&
      line.every(n => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1);
  }
  validLines(lines) {if (Array.isArray(lines) && lines.length > maxAppend) console.log("preventing append with many lines");
    return Array.isArray(lines) && lines.length > 0 && lines.length <= maxAppend && lines.every(line => this.validLine(line));
  }


  // 10 GET functions + 10 equivalent POST functions
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    // WebSocket: connection and 1 SELECT all/snapshot variation
    if (path === "/sql/ws" && request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].send(JSON.stringify({type:"snapshot", strokes:this.snapshot()}));
      return new Response(null, {status:101, webSocket:pair[0]});
    }

    if (!["GET", "POST"].includes(request.method)) return new Response("Method Not Allowed", {status:405});
    const params = new URLSearchParams(request.method === "GET" ? url.search.slice(1) : await request.text());
    const number = name => {const value = params.get(name); return value !== null && /^\d+$/.test(value) ? Number(value) : null;};

    // SELECT: 6 variations
    if (path === "/sql/read") {
      const mode = params.get("mode");
      const from = number("from");
      const to = number("to");
      if (mode === "range" || mode === "rowid-range") {
        if (from === null || to === null || from > to) return this.response("Invalid read range", 400);
        const rows = this.sql.exec(
          mode === "range" ? "SELECT data FROM strokes WHERE rowid >= ? AND rowid <= ? ORDER BY rowid" :
          "SELECT rowid, data FROM strokes WHERE rowid >= ? AND rowid <= ? ORDER BY rowid",
        from, to).toArray();
        return this.response(mode === "rowid-range" ? rows.map(row => ({rowid:row.rowid, data:JSON.parse(row.data)})) : rows.map(row => JSON.parse(row.data)));}
      if (mode === "all")
        return this.response(this.snapshot());
      if (mode === "max")
        return this.response(this.sql.exec("SELECT MAX(rowid) AS maxrowid FROM strokes").toArray()[0].maxrowid ?? 0);
      if (mode === "last") {
        const rows = this.sql.exec("SELECT rowid, data FROM strokes ORDER BY rowid DESC LIMIT 1").toArray();
        return this.response(rows.length ? {rowid:rows[0].rowid, data:JSON.parse(rows[0].data)} : null);}
      if (mode === "count")
        return this.response(this.sql.exec("SELECT COUNT(*) AS count FROM strokes").toArray()[0].count);
      return this.response("Unknown read mode", 400);
    }

    // INSERT: 1 VARIATION (allows one or multiple strokes)
    if (path === "/sql/append") {
      const from = number("from");
      let lines; try {lines = JSON.parse(params.get("data").replace(/,\s*([\]}])/g, "$1"));} catch {return this.response("Invalid append JSON data", 400);}
      if (from === null || !this.validLines(lines)) return this.response("Invalid append parameters (maxAppend=" + maxAppend + ")", 400);

      // Check anchor and insert atomically.
      let current;
      this.ctx.storage.transactionSync(() => {
        current = this.sql.exec("SELECT COALESCE(MAX(rowid), 0) AS maxrowid FROM strokes").toArray()[0].maxrowid; //****could change (for consistency with code above) to "SELECT MAX(rowid) AS maxrowid FROM strokes"
        if (from !== current) return;

        for (const line of lines) this.sql.exec("INSERT INTO strokes (data) VALUES (?)", JSON.stringify(line));
        //this.sql.exec("INSERT INTO strokes (data) VALUES " + lines.map(() => "(?)").join(","), ...lines.map(line => JSON.stringify(line)));

      });
      if (from !== current) return this.response({error:"Stale anchor", maxrowid:current}, 409);
      this.broadcast({type:"lines", lines});
      return this.response("Append OK");
    }

    // DELETE: 3 variations
    if (path === "/sql/delete") {
      const from = number("from");
      const to = number("to");
      if (from !== null && to !== null) {
        if (from > to) return this.response("Invalid DELETE range", 400);
        this.sql.exec("DELETE FROM strokes WHERE rowid >= ? AND rowid <= ?", from, to);
      } else if (from !== null && to === null) {
        this.sql.exec("DELETE FROM strokes WHERE rowid >= ?", from);
      } else if (from === null && to === null) {
        this.sql.exec("DELETE FROM strokes"); this.broadcast({type:"clear"});
        return this.response("Clear OK");
      } else {
        return this.response("Invalid DELETE parameters", 400);
      }
      this.broadcast({type:"snapshot", strokes:this.snapshot()});
      return this.response("Delete OK");
    }
    return new Response("Not Found", {status:404});
  }

  // WebSocket: 1 INSERT and 1 DELETE variation
  webSocketMessage(ws, message) {
    if (typeof message !== "string") return;
    let m; try {m = JSON.parse(message);} catch {return;}

    // 1. Insert one or more lines
    if (m.type === "lines") {if (!this.validLines(m.lines)) {ws.send(JSON.stringify({type:"error", error: "Invalid ws-append parameters (maxAppend=" + maxAppend + ")"})); return;}

      for (const line of m.lines) this.sql.exec("INSERT INTO strokes (data) VALUES (?)", JSON.stringify(line));
      //this.sql.exec("INSERT INTO strokes (data) VALUES " + m.lines.map(() => "(?)").join(","), ...m.lines.map(line => JSON.stringify(line)));

      for (const socket of this.ctx.getWebSockets()) if (socket !== ws && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(m));
    }
    // 1. Insert individual line: OBSOLETE: use "lines" instead
    //if (m.type === "line" && this.validLine(m.line)) {
    //    this.sql.exec("INSERT INTO strokes (data) VALUES (?)", JSON.stringify(m.line));
    //  for (const socket of this.ctx.getWebSockets()) if (socket !== ws && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(m));
    //}

    // 2. Clear drawing
    else if (m.type === "clear") {
      this.sql.exec("DELETE FROM strokes"); this.broadcast({type:"clear"});
    }
  }
}
