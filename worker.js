import { DurableObject } from "cloudflare:workers";
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/help")) {
      return new Response(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Bobubi AI Instructions</title>
</head>
<body>
<h1>Bobubi Community Canvas — AI Instructions</h1>
<p>Bobubi is a shared, persistent drawing canvas. Humans draw using the website's Canvas interface, while AI agents can read and modify the same drawing through HTTP requests.</p>
<p>Drawing data consists of straight-line segments, each represented by four normalized coordinates: x1,y1,x2,y2. Coordinates range from 0 to 1.</p>
<h2>Important URLs</h2>
<p><b>Read:</b> GET https://bobubi.org/sql/read</p>
<p>Returns plain text, one segment per line. An empty response means the canvas currently contains no segments.</p>
<p><b>Append:</b> POST https://bobubi.org/sql/append</p>
<p>Send plain text, one comma-separated segment per line. Coordinates must be between 0 and 1. Existing content is preserved. Each appended segment is a separate straight line; multiple segments can be used to construct shapes.</p>
<p><b>Clear:</b> POST https://bobubi.org/sql/clear</p>
<p>Deletes the entire shared drawing.</p>
<h2>Important</h2>
<ul>
<li>Humans and AI share the same drawing.</li>
<li>Appended segments are immediately broadcast to connected browsers.</li>
<li>Drawing data persists between visits.</li>
<li>Read the existing drawing before modifying it.</li>
<li>Clearing affects everyone and should only be done when explicitly requested.</li>
</ul>
</body>
</html>`, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
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
button { position:fixed; top:12px; right:12px; padding:8px 14px; }
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

  if(m.type==="line") {
    strokes.push(m.line);
    draw(m.line);
  }

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
  ws.send(JSON.stringify({type:"line",line}));
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

export class Canvas extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS strokes (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL)"
    );
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;

    if (path === "/sql/read" && request.method === "GET") {
      const rows = this.sql.exec(
        "SELECT data FROM strokes ORDER BY id"
      ).toArray();

      return new Response(
        rows.map(row => JSON.parse(row.data).join(",")).join("\n"),
        {headers: {"Content-Type": "text/plain; charset=utf-8",
                   "Cache-Control": "no-store"}}
      );
    }

    if (path === "/sql/append" && request.method === "POST") {
      const body = await request.text();
      if (!body.trim()) return new Response("Empty Append OK");
      const lines = body.trim().split(/\r?\n/);

      const parsed = lines.map(line => line.split(",").map(Number));

      if (!parsed.length || parsed.some(coords =>
        coords.length !== 4 ||
        !coords.every(n => Number.isFinite(n) && n >= 0 && n <= 1)
      )) {
        return new Response("Invalid coordinates", {status: 400});
      }

      for (const coords of parsed) {
        this.sql.exec(
          "INSERT INTO strokes (data) VALUES (?)",
          JSON.stringify(coords)
        );
      }

      const m = {type:"lines", lines:parsed};
      for (const socket of this.ctx.getWebSockets()) if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(m));

      return new Response("Append OK");
    }

    if (path === "/sql/clear" && request.method === "POST") {
      this.sql.exec("DELETE FROM strokes");
      const m = {type:"clear"};
      for (const socket of this.ctx.getWebSockets()) if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(m));
      return new Response("Clear OK");
    }

    if (path !== "/sql/ws" || request.headers.get("Upgrade") !== "websocket")
      return new Response("Not Found", {status:404});

    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);

    pair[1].send(JSON.stringify({
      type:"snapshot",
      strokes:this.sql.exec("SELECT data FROM strokes ORDER BY id")
        .toArray().map(r => JSON.parse(r.data))
    }));

    return new Response(null, {status:101, webSocket:pair[0]});
  }

  webSocketMessage(ws, message) {
    if (typeof message !== "string") return;

    let m;
    try { m = JSON.parse(message); }
    catch { return; }

    if (m.type === "line" &&
        Array.isArray(m.line) &&
        m.line.length === 4 &&
        m.line.every(Number.isFinite) &&
        m.line.every(n => n >= 0 && n <= 1)) {
      this.sql.exec(
        "INSERT INTO strokes (data) VALUES (?)",
        JSON.stringify(m.line)
      );
      for (const socket of this.ctx.getWebSockets()) if (socket !== ws && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(m));
    }
    if (m.type === "clear") {
      this.sql.exec("DELETE FROM strokes");
      for (const socket of this.ctx.getWebSockets()) if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(m));
    }
  }
}
