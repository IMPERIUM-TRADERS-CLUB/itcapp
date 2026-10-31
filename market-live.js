(() => {
  "use strict";
  const cfg = window.ITC_CONFIG || {};
  const APP_ID = String(cfg.DERIV_APP_ID || "").trim();
  const MAX_TICKS = Math.max(60, Number(cfg.MAX_TICKS || 160));
  const markets = {
    "Volatility 10 Index": {symbol:"R_10", short:"V10", decimals:3},
    "Volatility 25 Index": {symbol:"R_25", short:"V25", decimals:3},
    "Volatility 50 Index": {symbol:"R_50", short:"V50", decimals:4},
    "Volatility 75 Index": {symbol:"R_75", short:"V75", decimals:4},
    "Volatility 100 Index": {symbol:"R_100", short:"V100", decimals:2},
    "Volatility 10 (1s) Index": {symbol:"1HZ10V", short:"V10 (1s)", decimals:2},
    "Volatility 15 (1s) Index": {symbol:"1HZ15V", short:"V15 (1s)", decimals:3},
    "Volatility 25 (1s) Index": {symbol:"1HZ25V", short:"V25 (1s)", decimals:2},
    "Volatility 30 (1s) Index": {symbol:"1HZ30V", short:"V30 (1s)", decimals:3},
    "Volatility 50 (1s) Index": {symbol:"1HZ50V", short:"V50 (1s)", decimals:2},
    "Volatility 75 (1s) Index": {symbol:"1HZ75V", short:"V75 (1s)", decimals:2},
    "Volatility 90 (1s) Index": {symbol:"1HZ90V", short:"V90 (1s)", decimals:3},
    "Volatility 100 (1s) Index": {symbol:"1HZ100V", short:"V100 (1s)", decimals:2},
    "Jump 10 Index": {symbol:"JD10", short:"J10", decimals:2},
    "Jump 25 Index": {symbol:"JD25", short:"J25", decimals:2},
    "Jump 50 Index": {symbol:"JD50", short:"J50", decimals:2},
    "Jump 75 Index": {symbol:"JD75", short:"J75", decimals:2},
    "Jump 100 Index": {symbol:"JD100", short:"J100", decimals:2}
  };
  const state = {
    socket:null, connected:false, selected:"Volatility 75 Index", tickHistory:{},
    latest:{}, previous:{}, counts:Array(10).fill(0), totalTicks:0,
    recentDigits:[], analysisWindow:100, analysisMode:"overunder", analysisSide:{overunder:"over",evenodd:"even",matchesdiffers:"matches"}, analysisThreshold:5, reconnectTimer:null, pingTimer:null, chartHistoryLoaded:{}
  };
  Object.keys(markets).forEach(k => state.tickHistory[markets[k].symbol] = []);
  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => [...root.querySelectorAll(s)];
  const priceText = n => Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:8});
  const symbol = () => markets[state.selected]?.symbol || "R_75";

  // Read-only data bridge for the on-page Smart Scanner; no trade actions are exposed.
  window.ITC_MARKET_DATA = {
    marketNames: Object.keys(markets),
    selectMarket(name) { selectMarket(name); },
    getMarkets() {
      return Object.entries(markets).map(([name, info]) => ({
        name, symbol: info.symbol,
        ticks: (state.tickHistory[info.symbol] || []).map(item => ({
          price: Number(item.price),
          digit: getDigit(Number(item.price), info.decimals),
          epoch: Number(item.epoch || 0)
        }))
      }));
    },
    getStatus() { return { connected: state.connected, selected: state.selected }; }
  };

  function setStatus(connected, message) {
    state.connected = connected;
    const pill = $("#marketConnectionPill");
    const dot = $("#marketConnectionDot");
    const badge = $("#marketFeedBadge");
    const stream = $("#chartStreamLabel");
    if (pill) pill.innerHTML = `<span class="status-dot" id="marketConnectionDot"></span> ${connected ? "LIVE MARKET DATA" : "CONNECTING MARKET"}`;
    const liveDot = $("#marketConnectionDot");
    if (liveDot) {
      liveDot.style.background = connected ? "var(--mint)" : "var(--amber)";
      liveDot.style.boxShadow = connected ? "0 0 7px #5ee2b590" : "none";
    }
    if (badge) {
      badge.textContent = connected ? "LIVE" : "CONNECTING";
      badge.style.color = connected ? "var(--mint)" : "var(--amber)";
    }
    if (stream) {
      stream.innerHTML = `<span class="status-dot" style="background:${connected ? "var(--mint)" : "var(--amber)"}"></span> ${connected ? "Live Deriv tick stream" : message || "Connecting to Deriv…"}`;
    }
    $$('[data-market-status]').forEach(el => {
      el.textContent = connected ? "Live public ticks" : (message && message.startsWith('Deriv API error:') ? "Connection error · retrying" : (message || "Connecting to Deriv"));
      el.classList.toggle('is-live', connected);
    });
    $$('[data-market-dot]').forEach(el => {
      el.style.background = connected ? "var(--mint)" : "var(--amber)";
      el.style.boxShadow = connected ? "0 0 7px #5ee2b590" : "none";
    });
    const statusRows = $$(".integration-row");
    statusRows.forEach(row => {
      if (row.textContent.includes("Deriv API") || row.textContent.includes("Live chart feed")) {
        const status = $(".setting-state", row);
        if (status) {
          status.textContent = connected ? "Live market data" : "Connecting";
          status.classList.toggle("enabled", connected);
          status.classList.toggle("disconnected", !connected);
        }
      }
    });
    if (!connected && message && message.startsWith("Deriv API error:")) {
      const pill2 = $("#marketConnectionPill");
      if (pill2) pill2.title = message;
    }
  }

  function send(obj) {
    if (state.socket && state.socket.readyState === WebSocket.OPEN) state.socket.send(JSON.stringify(obj));
  }

  function connect() {
    if (!APP_ID || APP_ID === "YOUR_DERIV_APP_ID") {
      setStatus(false, "Deriv App ID is missing");
      return;
    }
    clearTimeout(state.reconnectTimer);
    clearInterval(state.pingTimer);
    try {
      if (state.socket) {
        state.socket.onclose = null;
        state.socket.close();
      }
      setStatus(false, "Opening secure market connection…");
      const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(APP_ID)}`);
      state.socket = ws;
      ws.onopen = () => {
        setStatus(true);
        // Subscribe to public tick streams for the market watch list.
        send({ticks: Object.values(markets).map(m => m.symbol), subscribe: 1, req_id: 10});
        requestHistory(symbol());
        state.pingTimer = setInterval(() => send({ping:1}), 30000);
      };
      ws.onmessage = event => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        if (msg.error) {
          setStatus(false, `Deriv API error: ${msg.error.message}`);
          console.warn("Deriv API:", msg.error);
          return;
        }
        if (msg.msg_type === "tick" && msg.tick) handleTick(msg.tick);
        if (msg.msg_type === "history" && msg.history && msg.echo_req) {
          const sym = msg.echo_req.ticks_history;
          if (sym && Array.isArray(msg.history.prices)) {
            const list = msg.history.prices.map((p,i) => ({price:Number(p), epoch:Number(msg.history.times?.[i] || 0)})).filter(x => Number.isFinite(x.price));
            state.tickHistory[sym] = list.slice(-MAX_TICKS);
            state.chartHistoryLoaded[sym] = true;
            if (sym === symbol()) { drawAllCharts(); updateDigitStats(); updateSignalSummary(); }
          }
        }
      };
      ws.onerror = () => setStatus(false, "Market connection error");
      ws.onclose = () => {
        setStatus(false, "Market disconnected — retrying");
        clearInterval(state.pingTimer);
        state.reconnectTimer = setTimeout(connect, Number(cfg.RECONNECT_MS || 3500));
      };
    } catch (err) {
      console.error(err);
      setStatus(false, "Could not open market connection");
      state.reconnectTimer = setTimeout(connect, Number(cfg.RECONNECT_MS || 3500));
    }
  }

  function requestHistory(sym) {
    if (state.socket?.readyState !== WebSocket.OPEN) return;
    send({ticks_history:sym, count:MAX_TICKS, end:"latest", style:"ticks", req_id: 100 + Object.values(markets).findIndex(m=>m.symbol===sym)});
  }

  function getDigit(quote, pip) {
    const decimals = Math.max(0, Number(pip || 2));
    const fixed = Number(quote).toFixed(Math.min(8, decimals));
    const digits = fixed.replace(".", "").replace("-", "");
    return Number(digits.slice(-1));
  }

  function handleTick(tick) {
    const sym = tick.symbol;
    const info = Object.values(markets).find(m => m.symbol === sym);
    if (!info) return;
    const price = Number(tick.quote);
    if (!Number.isFinite(price)) return;
    if (Number.isInteger(tick.pip_size) && tick.pip_size >= 0) info.decimals = tick.pip_size;
    const previous = state.latest[sym];
    state.previous[sym] = previous;
    state.latest[sym] = {price, epoch:Number(tick.epoch || Date.now()/1000), pip:tick.pip_size};
    const arr = state.tickHistory[sym] || (state.tickHistory[sym] = []);
    arr.push({price, epoch:Number(tick.epoch || Date.now()/1000)});
    if (arr.length > MAX_TICKS) arr.splice(0, arr.length - MAX_TICKS);
    if (sym === symbol()) {
      const d = getDigit(price, tick.pip_size ?? info.decimals);
      state.counts[d]++; state.totalTicks++;
      state.recentDigits.unshift(d); state.recentDigits = state.recentDigits.slice(0,60);
      updateDigitStats();
      updateSignalSummary();
      updatePrimaryPrice();
      drawAllCharts();
    }
    updateWatchlist(info, price, previous?.price);
    updateDTraderPrice();
    setStatus(true);
  }

  function updatePrimaryPrice() {
    const latest = state.latest[symbol()];
    if (!latest) return;
    const main = $("#mainPrice");
    if (main) main.textContent = priceText(latest.price);
    const change = $("#priceChange");
    const prev = state.previous[symbol()]?.price;
    if (change) {
      const pct = prev ? ((latest.price-prev)/prev)*100 : 0;
      change.textContent = `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(3)}% tick`;
      change.classList.toggle("positive", pct >= 0);
      change.classList.toggle("negative", pct < 0);
    }
    const heading = $("#page-dashboard .chart-panel .panel-heading h2");
    if (heading) heading.innerHTML = `${state.selected} <span class="select-chevron">⌄</span>`;
    const label = $("#chartStreamLabel");
    if (label) label.innerHTML = '<span class="status-dot"></span> Live Deriv tick stream';
  }

  function updateDTraderPrice() {
    const latest = state.latest[symbol()];
    if (!latest) return;
    const instrument = $("#dtraderInstrument"); if (instrument) instrument.textContent = state.selected;
    const dtraderPrice = $("#dtraderPrice"); if (dtraderPrice) dtraderPrice.textContent = priceText(latest.price);
    if ($("#dtraderChange")) {
      const prev = state.previous[symbol()]?.price;
      const pct = prev ? (latest.price-prev)/prev*100 : 0;
      const dtraderChange = $("#dtraderChange");
      dtraderChange.textContent = `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(3)}% tick`;
      dtraderChange.classList.toggle("positive", pct >= 0);
      dtraderChange.classList.toggle("negative", pct < 0);
    }
    const ticketMarket = $("#ticketMarket"); if (ticketMarket) ticketMarket.textContent = markets[state.selected].short;
    const orderName = $(".order-market-name small");
    if (orderName) orderName.textContent = "Live public quote";
  }

  function updateWatchlist(info, price, previous) {
    const name = Object.keys(markets).find(k => markets[k] === info);
    const row = $$(".market-row").find(r => r.dataset.market === name);
    if (!row) return;
    const priceEl = $(".market-price", row);
    if (priceEl) priceEl.textContent = priceText(price);
    const changeEl = $(".market-change", row);
    if (changeEl && previous) {
      const pct = (price - previous) / previous * 100;
      changeEl.textContent = `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(3)}%`;
      changeEl.classList.toggle("up", pct >= 0);
      changeEl.classList.toggle("down", pct < 0);
    }
    const foot = $(".watchlist-foot");
    if (foot) foot.innerHTML = '<span class="small-ring">↻</span> Live quotes from Deriv';
  }

  function updateDigitStats() {const sd=$("#analysisSide");if(sd&&!sd.children.length&&typeof renderSide==="function")renderSide();
    const panel = $("#liveDigitPanel");
    const name = state.selected, info = markets[name], ticks = (state.tickHistory[info.symbol] || []).slice(-state.analysisWindow);
    const digits = ticks.map(t => getDigit(Number(t.price), info.decimals));
    const counts = Array(10).fill(0); digits.forEach(d => counts[d]++);
    const total = digits.length, ranked = [...counts].sort((a,b)=>b-a), top=ranked[0], second=ranked.find(v=>v<top), bottom=ranked[ranked.length-1], secondBottom=[...ranked].reverse().find(v=>v>bottom);
    const rankClass = c => !total?'':(c===top?'rank-top':(second!==undefined&&c===second?'rank-second':(c===bottom&&bottom!==top?'rank-bottom':(secondBottom!==undefined&&c===secondBottom?'rank-second-bottom':''))));
    const rankLabel = c => c===top?'MOST FREQUENT':(second!==undefined&&c===second?'2ND MOST':(c===bottom&&bottom!==top?'LEAST FREQUENT':(secondBottom!==undefined&&c===secondBottom?'2ND LEAST':'')));
    if (panel) panel.innerHTML = counts.map((count,d) => { const pct=total?count/total*100:0; return `<div class="live-digit ${rankClass(count)}"><strong class="digit-circle">${d}</strong><span>${count} ticks</span><small>${pct.toFixed(1)}%</small><span class="rank-label">${total?rankLabel(count):'WAITING'}</span><i class="digit-bar-small"><b style="width:${pct}%"></b></i><i class="digit-bar-large"><b style="width:${pct}%"></b></i></div>`; }).join("");
    if (panel && !document.getElementById('digitLegend')) { const lg = document.createElement('div'); lg.id = 'digitLegend'; lg.className = 'digit-legend'; lg.innerHTML = '<span class="lg green">Most</span><span class="lg blue">2nd most</span><span class="lg orange">2nd least</span><span class="lg red">Least</span>'; panel.insertAdjacentElement('afterend', lg); }
    const dashboardMarket = $("#dashboardMarketName"); if (dashboardMarket) dashboardMarket.textContent = name;
    const dashboardTicks = $("#dashboardTickCount"); if (dashboardTicks) dashboardTicks.textContent = total ? `${total.toLocaleString()} ticks available` : "Waiting for ticks";
    const recent = $("#recentLiveDigits"); if (recent) recent.innerHTML = digits.slice(-60).reverse().map(d=>`<span>${d}</span>`).join("") || '<small>Waiting for ticks…</small>';
    if ($("#liveTickCount")) $("#liveTickCount").textContent = total.toLocaleString();
    const summary=$("#analysisModeSummary");
    if(summary){
      const mode=state.analysisMode;
      if(!total){summary.textContent=`Waiting for ${name} tick history. No ticks from another market are used.`;}
      else if(mode==='digits'){summary.textContent=`${name} · ${total} of ${state.analysisWindow} requested ticks available. Digit percentages below use only this market’s history.`;}
      else if(mode==='overunder'){const threshold=state.analysisThreshold,over=digits.filter(d=>d>threshold).length,under=digits.filter(d=>d<threshold).length,equal=digits.filter(d=>d===threshold).length;summary.textContent=`Over ${threshold}: ${over} (${(over/total*100).toFixed(1)}%) · Under ${threshold}: ${under} (${(under/total*100).toFixed(1)}%) · Equal ${threshold}: ${equal}. The threshold digit is not counted as Over or Under.`;}
      else if(mode==='evenodd'){const even=digits.filter(d=>d%2===0).length,odd=total-even;summary.textContent=`Even: ${even} (${(even/total*100).toFixed(1)}%) · Odd: ${odd} (${(odd/total*100).toFixed(1)}%).`;}
      else if(mode==='matchesdiffers'){const target=state.analysisThreshold,matches=digits.filter(d=>d===target).length,differs=total-matches;summary.textContent=`Matches ${target}: ${matches} (${(matches/total*100).toFixed(1)}%) · Differs ${target}: ${differs} (${(differs/total*100).toFixed(1)}%).`;}
      else {const rises=ticks.slice(1).filter((t,i)=>Number(t.price)>Number(ticks[i].price)).length, falls=ticks.slice(1).filter((t,i)=>Number(t.price)<Number(ticks[i].price)).length, unchanged=Math.max(0,ticks.length-1-rises-falls), n=Math.max(1,ticks.length-1);summary.textContent=`Tick-to-tick movement · Rise: ${rises} (${(rises/n*100).toFixed(1)}%) · Fall: ${falls} (${(falls/n*100).toFixed(1)}%) · Unchanged: ${unchanged}.`;}
    }
    $$('.analysis-mode').forEach(btn=>btn.classList.toggle('active',btn.dataset.analysisMode===state.analysisMode));
    try { renderStrength(digits); } catch (_) {}
  }

  // ---- Strength bars + digit strings (below the digit circles) ----
  function renderStrength(digits) {
    const circles = $("#liveDigitPanel"); if (!circles) return;
    let box = document.getElementById('strengthPanel');
    if (!box) { box = document.createElement('div'); box.id = 'strengthPanel'; box.className = 'strength-panel'; (document.getElementById('digitLegend') || circles).insertAdjacentElement('afterend', box); }
    const mode = state.analysisMode, side = state.analysisSide[mode], d = Number(state.analysisThreshold), total = digits.length;
    const range = (a, b) => a > b ? '-' : (a === b ? String(a) : a + '–' + b);
    let top, bot;   // {label, hit(digit) -> boolean, key}
    if (mode === 'evenodd') {
      top = { name: 'Even', sub: '', hit: x => x % 2 === 0, k: 'E', mine: side === 'even' };
      bot = { name: 'Odd', sub: '', hit: x => x % 2 === 1, k: 'O', mine: side === 'odd' };
    } else if (mode === 'overunder') {
      const overWins = side !== 'under';       // Over d wins on > d; Under d wins on < d
      const topHit = overWins ? (x => x > d) : (x => x >= d);
      top = { name: overWins ? 'Over ' + d : 'High', sub: overWins ? range(d + 1, 9) : range(d, 9), hit: topHit, k: '▲', mine: overWins };
      bot = { name: overWins ? 'Low' : 'Under ' + d, sub: overWins ? range(0, d) : range(0, d - 1), hit: x => !topHit(x), k: '▼', mine: !overWins };
    } else if (mode === 'matchesdiffers') {
      top = { name: 'Matches ' + d, sub: '', hit: x => x === d, k: 'M', mine: side === 'matches' };
      bot = { name: 'Differs ' + d, sub: '', hit: x => x !== d, k: 'D', mine: side === 'differs' };
    } else { box.style.display = 'none'; return; }
    box.style.display = '';
    const a = total ? Math.round(digits.filter(top.hit).length / total * 1000) / 10 : 0, b = total ? Math.round((100 - a) * 10) / 10 : 0;
    const dir = a > b ? 'top-strong' : (b > a ? 'bot-strong' : 'even');
    const row = (o, pct, cls) => `<div class="str-row ${cls}"><div class="str-label"><b>${o.name}</b>${o.sub ? `<small>${o.sub}</small>` : ''}${o.mine ? '<em>your side</em>' : ''}</div><div class="str-track"><i style="width:${pct}%"></i></div><div class="str-pct">${total ? pct.toFixed(1) + '%' : '--'}</div></div>`;
    const n = window.innerWidth < 700 ? 16 : 30, last = digits.slice(-n);
    const cells = last.map((x, i) => `<span class="${i === last.length - 1 ? 'new' : ''}">${x}</span>`).join('');
    const marks = last.map((x, i) => { const w = top.hit(x); return `<span class="${w ? 'g' : 'r'} ${i === last.length - 1 ? 'new' : ''}">${w ? top.k : bot.k}</span>`; }).join('');
    box.innerHTML = `<div class="str-title">Strength <small>${total ? 'last ' + total + ' ticks · totals 100%' : 'waiting for ticks'}</small></div>` +
      row(top, a, dir === 'top-strong' ? 'strong' : (dir === 'even' ? 'tie' : 'weak')) + row(bot, b, dir === 'bot-strong' ? 'strong' : (dir === 'even' ? 'tie' : 'weak')) +
      `<div class="str-strings"><div class="str-line"><span class="str-tag">Digits</span><div class="str-cells">${cells || '<small>Waiting for ticks…</small>'}</div></div><div class="str-line"><span class="str-tag">${top.k}/${bot.k}</span><div class="str-cells marks">${marks}</div></div></div>`;
  }
  window.addEventListener('itc:analysis-choice', () => { try { updateDigitStats(); } catch (_) {} });

  function updateSignalSummary() {
    const page = $("#page-signals");
    if (!page) return;
    const body = $("tbody", page);
    if (!body) return;
    const even = state.recentDigits.filter(d=>d%2===0).length;
    const odd = state.recentDigits.length-even;
    const over = state.recentDigits.filter(d=>d>5).length;
    const under = state.recentDigits.length-over;
    if ($("#liveTickCountTop")) $("#liveTickCountTop").textContent = state.totalTicks.toLocaleString();
    if ($("#liveEvenOdd")) $("#liveEvenOdd").textContent = state.recentDigits.length ? `${even}/${odd}` : "—";
    if ($("#liveOverUnder")) $("#liveOverUnder").textContent = state.recentDigits.length ? `${over}/${under}` : "—";
    const rows = [
      ["Even / Odd distribution", `${even} even · ${odd} odd`, "Recent 60 ticks", "neutral", "Observing"],
      ["Last digit frequency", "Digits 0–9", "This session", "neutral", "Observing"],
      ["Short price movement", "Tick-to-tick", "Live stream", "neutral", "Observing"],
      ["Over / Under threshold", "Digit threshold 5", "Recent 60 ticks", "neutral", "Observing"]
    ];
    // Only rewrite the sample table if it was explicitly marked as live.
    if (body.dataset.liveMode === "true") {
      body.innerHTML = rows.map((r,i)=>`<tr><td><strong>${r[0]}</strong><small>${r[1]}</small></td><td>${r[2]}</td><td>Live</td><td><span class="bias-${r[3]}">${r[4]}</span></td><td><span class="table-status">Descriptive</span></td><td><button class="table-action" type="button" data-live-info="${i}">Details</button></td></tr>`).join("");
    }
  }

  function drawChart(canvas) {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(260, rect.width || 500);
    const height = Math.max(180, rect.height || 230);
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = Math.round(width*dpr); canvas.height = Math.round(height*dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,width,height);
    const points = state.tickHistory[symbol()] || [];
    const pad={left:8,right:57,top:12,bottom:20}, chartW=width-pad.left-pad.right, chartH=height-pad.top-pad.bottom;
    ctx.strokeStyle="#202838";ctx.lineWidth=1;
    for(let i=0;i<=4;i++){const y=pad.top+chartH*i/4;ctx.beginPath();ctx.moveTo(pad.left,y);ctx.lineTo(width-pad.right+2,y);ctx.stroke()}
    for(let i=0;i<=5;i++){const x=pad.left+chartW*i/5;ctx.beginPath();ctx.moveTo(x,pad.top);ctx.lineTo(x,pad.top+chartH);ctx.stroke()}
    if(points.length<2){
      ctx.fillStyle="#8993a8";ctx.font="11px system-ui";ctx.fillText(state.connected?"Collecting tick history…":"Waiting for Deriv market connection…",12,height/2);
      return;
    }
    const vals=points.map(p=>p.price), min=Math.min(...vals), max=Math.max(...vals), range=max-min||Math.max(1,Math.abs(max)*0.0001);
    const y=v=>pad.top+(max-v)/range*chartH, x=i=>pad.left+i/(points.length-1)*chartW;
    ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(x(i),y(p.price)):ctx.moveTo(x(i),y(p.price)));
    ctx.lineWidth=2;ctx.strokeStyle="#9a7bff";ctx.stroke();
    const fill=ctx.createLinearGradient(0,pad.top,0,pad.top+chartH);fill.addColorStop(0,"#9a7bff32");fill.addColorStop(1,"#9a7bff00");
    ctx.lineTo(x(points.length-1),pad.top+chartH);ctx.lineTo(x(0),pad.top+chartH);ctx.closePath();ctx.fillStyle=fill;ctx.fill();
    const latest=points[points.length-1], cy=y(latest.price);
    ctx.save();ctx.setLineDash([4,4]);ctx.strokeStyle="#9a7bff88";ctx.beginPath();ctx.moveTo(pad.left,cy);ctx.lineTo(width-pad.right+2,cy);ctx.stroke();ctx.restore();
    ctx.fillStyle="#9a7bff";ctx.fillRect(width-pad.right+5,cy-8,pad.right-7,16);
    ctx.fillStyle="#080b12";ctx.font='8px "DM Mono",monospace';ctx.textAlign="center";ctx.fillText(priceText(latest.price),width-pad.right/2+2,cy+3);
    ctx.fillStyle="#59667e";ctx.textAlign="right";
    for(let i=0;i<=4;i++){const val=max-range*i/4;ctx.fillText(priceText(val),width-3,pad.top+chartH*i/4+3)}
  }
  function drawAllCharts() {
    drawChart($("#marketChart"));
    drawChart($("#dtraderChart"));
  }

  function selectMarket(name) {
    if (!markets[name]) return;
    state.selected = name;
    state.counts.fill(0); state.totalTicks = 0; state.recentDigits = [];
    updateDigitStats(); updateSignalSummary();
    $$(".market-row").forEach(row=>row.classList.toggle("selected-market",row.dataset.market===name));
    ["#dtraderMarket", "#settingsMarket", "#analysisMarketSelect", "#marketSelect", "#manualMarket", "#bulkMarket"].forEach(selector=>{
      const control=$(selector);
      if(control && [...control.options].some(option=>option.value===name || option.textContent.trim()===name)) control.value=name;
    });
    const info=markets[name];
    if (!state.chartHistoryLoaded[info.symbol]) requestHistory(info.symbol);
    updatePrimaryPrice();updateDTraderPrice();drawAllCharts();
    window.dispatchEvent(new CustomEvent("itc:market-change", {detail:{name, symbol:info.symbol}}));
  }

  // Capture clicks before the prototype's demo handlers repaint old prices.
  document.addEventListener("click", e=>{
    const row=e.target.closest(".market-row");
    if(row){setTimeout(()=>selectMarket(row.dataset.market),0);return;}
    const page=e.target.closest("[data-page]");
    if(page && page.dataset.page==="dtrader"){setTimeout(drawAllCharts,50)}
    const liveDetail=e.target.closest("[data-live-info]");
    if(liveDetail) {
      const text=["Even and odd counts describe only the most recent session ticks.","Digit frequency is historical and is not a forecast of the next digit.","The price direction compares recent quotes only.","Over/Under counts compare observed last digits against the threshold."][Number(liveDetail.dataset.liveInfo)||0];
      alert(text);
    }
  }, true);
  $("#dtraderMarket")?.addEventListener("change",e=>selectMarket(e.target.value));
  $("#settingsMarket")?.addEventListener("change",e=>selectMarket(e.target.value));
  window.addEventListener("resize",()=>requestAnimationFrame(drawAllCharts));
  window.addEventListener("load",()=>setTimeout(drawAllCharts,150));

  document.addEventListener("change", e=>{ if(e.target?.id==="analysisMarketSelect"){selectMarket(e.target.value);return;} if(e.target?.id==="analysisTickWindow"){state.analysisWindow=Number(e.target.value)||100;updateDigitStats();} if(e.target?.id==="analysisThreshold"){state.analysisThreshold=Number(e.target.value);updateDigitStats();announceChoice();} });
  const SIDES={overunder:[["over","Over"],["under","Under"]],evenodd:[["even","Even"],["odd","Odd"]],matchesdiffers:[["matches","Matches"],["differs","Differs"]]};
  function renderSide(){const el=$("#analysisSide");if(!el)return;const mode=state.analysisMode,list=SIDES[mode]||[];el.innerHTML=list.map(([v,l])=>'<button type="button" class="analysis-side-btn'+(state.analysisSide[mode]===v?' active':'')+'" data-analysis-side="'+v+'">'+l+'</button>').join("");}
  function announceChoice(){window.dispatchEvent(new CustomEvent("itc:analysis-choice",{detail:{mode:state.analysisMode,side:state.analysisSide[state.analysisMode],barrier:Number(state.analysisThreshold)}}));}
  document.addEventListener("click", e=>{const b=e.target.closest("[data-analysis-mode]");if(b&&SIDES[b.dataset.analysisMode]){state.analysisMode=b.dataset.analysisMode;renderSide();updateDigitStats();announceChoice();return;}const s=e.target.closest("[data-analysis-side]");if(s){state.analysisSide[state.analysisMode]=s.dataset.analysisSide;renderSide();announceChoice();}});
  renderSide();
  window.addEventListener("itc:market-change", e=>{const name=e.detail?.name;if(name&&markets[name]){state.selected=name;state.counts.fill(0);state.totalTicks=0;state.recentDigits=[];updateDigitStats();updateSignalSummary();}});

  // Remove hard-coded demo quotes until the first real tick for each symbol arrives.
  const mainPriceEl = $("#mainPrice"); if (mainPriceEl) mainPriceEl.textContent = "—";
  const dtraderPriceEl = $("#dtraderPrice"); if (dtraderPriceEl) dtraderPriceEl.textContent = "—";
  $$(".market-price").forEach(el => el.textContent = "—");
  $$(".market-change").forEach(el => { el.textContent = "—"; el.classList.remove("up","down"); });

  // Label market charts as real-time line charts, not candlesticks.
  const legend=$(".chart-legend");
  if(legend) legend.innerHTML='<span><i class="legend-up"></i> Live tick price</span><span class="chart-disclaimer">Public market data · not a forecast</span>';
  const dtraderDisclaimer=$(".trade-note");
  if(dtraderDisclaimer) dtraderDisclaimer.textContent="Live public price feed. Practice buttons remain local only; no order is sent to Deriv.";
  const watchHead=$(".watchlist-head");
  if(watchHead) watchHead.children[1].textContent="LIVE PRICE";
  const signalsTable=$("#page-signals tbody");
  if(signalsTable) {
    signalsTable.dataset.liveMode="true";
    signalsTable.innerHTML='<tr class="empty-table-row"><td colspan="6">Waiting for live market ticks…</td></tr>';
  }

  // Display a compact live-digit panel in Signals, inserted ahead of the example table.
  const signalPage=$("#page-signals");
  if(signalPage && !$("#liveDigitPanel")) {
    const panel=document.createElement("article");
    panel.className="panel signals-table-panel digit-circle-analysis-panel";
    panel.id="digitCircleAnalysisPanel";
    panel.innerHTML='<div class="panel-heading"><div><div class="panel-overline">LIVE TICK ANALYSIS</div><h2>Digit frequency & market balance</h2><p class="muted-text">Percentages are calculated from this selected market’s own recent tick history.</p></div><span class="demo-pill"><span class="status-dot"></span> OBSERVATION ONLY</span></div><div class="analysis-market-inline" id="analysisMarketInline"></div><div class="analysis-tools"><label>Tick window <select id="analysisTickWindow" class="dark-select"><option value="100">Last 100 ticks</option><option value="500">Last 500 ticks</option><option value="1000">Last 1,000 ticks</option></select></label><label>Threshold / target digit <select id="analysisThreshold" class="dark-select"><option value="0">0</option><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5" selected>5</option><option value="6">6</option><option value="7">7</option><option value="8">8</option><option value="9">9</option></select></label><div class="analysis-mode-tabs" role="group" aria-label="Contract type"><button type="button" class="analysis-mode active" data-analysis-mode="overunder">Over / Under</button><button type="button" class="analysis-mode" data-analysis-mode="evenodd">Even / Odd</button><button type="button" class="analysis-mode" data-analysis-mode="matchesdiffers">Matches / Differs</button></div><div class="analysis-side" id="analysisSide" aria-label="Pick a side"></div></div><div id="analysisModeSummary" class="analysis-mode-summary">Collecting live tick history…</div><div class="live-digit-grid" id="liveDigitPanel"></div><div class="live-digit-foot">Green = most frequent rank; blue = second most frequent; red = least frequent; amber outline = second least frequent. Tied ranks share a style. Historical frequencies are not predictions.</div><div class="recent-live-row"><strong>Recent digits</strong><div id="recentLiveDigits" class="recent-live-digits"></div><span>Ticks: <b id="liveTickCount">0</b></span></div>';
    const heading=signalPage.querySelector(".page-heading");
    const chooser=document.createElement("div");
    chooser.className="analysis-view-chooser";
    chooser.id="analysisViewChooser";
    chooser.innerHTML='<div class="analysis-view-intro"><strong>Analysis Tool</strong><span>Choose how you want to analyse the selected market.</span></div><div class="analysis-view-buttons" role="group" aria-label="Analysis view"><button type="button" class="analysis-view-button active" data-analysis-view="digits" aria-pressed="true"><span class="view-button-icon">◉</span><strong>Digit Circles</strong><small>Frequency of digits 0–9</small></button><button type="button" class="analysis-view-button" data-analysis-view="smart" aria-pressed="false"><span class="view-button-icon">⌁</span><strong>Smart Analysis</strong><small>Current scanner and summaries</small></button></div>';
    if(heading) heading.after(chooser); else signalPage.prepend(chooser);
    const botLauncher=signalPage.querySelector('.analysis-bot-launcher');
    if(botLauncher){
      botLauncher.classList.add('analysis-bot-compact');
      const copy=botLauncher.querySelector('.analysis-bot-launcher-copy');
      if(copy) copy.innerHTML='<div class="panel-overline">BOT CONTROL</div><strong>Run the bot</strong>';
      const controls=botLauncher.querySelector('.analysis-bot-controls');
      if(controls){
        const speed=document.createElement('label');speed.className='analysis-speed-control';speed.innerHTML='Demo pace <select id="analysisBotSpeed" class="dark-select" aria-label="Demo simulation pace" title="Display preference only; Run currently records one local demo cycle"><option value="slow">Slow</option><option value="fast" selected>Fast</option></select>';
        controls.appendChild(speed);
        const run=controls.querySelector('#analysisRunBot');if(run)run.textContent='▶ Run bot';
        const stop=document.createElement('button');stop.type='button';stop.className='button secondary';stop.id='analysisStopBot';stop.textContent='■ Stop';stop.disabled=true;controls.appendChild(stop);
      }
      const note=botLauncher.querySelector('.form-footnote');if(note)note.textContent='Demo simulation only — no live Deriv orders are placed. Stop ends the demo session indicator.';
      panel.appendChild(botLauncher);
    }
    const summary=signalPage.querySelector(".signal-summary-grid");
    if(summary) summary.after(panel); else signalPage.append(panel);
    const sharedMarket=signalPage.querySelector('.analysis-market-sync');
    const marketSlot=panel.querySelector('#analysisMarketInline');
    if(marketSlot){
      // Always give the digit panel its own market selector (older layouts had none, so it was missing).
      let marketSelect=document.getElementById('analysisMarketSelect');
      let badge=document.getElementById('sharedMarketBadge');
      const current=state.selected||Object.keys(markets)[0];
      if(!marketSelect){
        marketSelect=document.createElement('select');
        marketSelect.id='analysisMarketSelect'; marketSelect.className='dark-select'; marketSelect.setAttribute('aria-label','Select market');
        marketSelect.innerHTML=Object.keys(markets).map(n=>'<option value="'+n+'">'+n+'</option>').join('');
      }
      marketSelect.value=current;
      if(!badge){ badge=document.createElement('span'); badge.id='sharedMarketBadge'; badge.className='template-tag'; }
      badge.textContent='SELECTED · '+current;
      marketSlot.innerHTML='<label for="analysisMarketSelect">MARKET</label>';
      marketSlot.appendChild(marketSelect); marketSlot.appendChild(badge);
      if(sharedMarket) sharedMarket.remove();
    }
    const setAnalysisView=(view)=>{
      const circles=view==='digits';
      chooser.querySelectorAll('[data-analysis-view]').forEach(btn=>{const active=btn.dataset.analysisView===view;btn.classList.toggle('active',active);btn.setAttribute('aria-pressed',String(active));});
      panel.hidden=!circles;
      signalPage.querySelectorAll('.scanner-panel,.signal-summary-grid,.signals-table-panel:not(#digitCircleAnalysisPanel)').forEach(el=>{el.hidden=circles;});
      signalPage.dataset.analysisView=view;
      if(circles) updateDigitStats();
    };
    chooser.addEventListener('click',e=>{const b=e.target.closest('[data-analysis-view]');if(b)setAnalysisView(b.dataset.analysisView);});
    setAnalysisView('digits');
  }
  const liveCss=document.createElement("style");
  const botPanelCss=document.createElement('style');
  botPanelCss.textContent=`
    #digitCircleAnalysisPanel .analysis-bot-compact{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:9px 10px;margin:10px 0;border:1px solid #735b2e;border-radius:10px;background:linear-gradient(95deg,#211c12,#101b25 70%,#17211d)}
    #digitCircleAnalysisPanel .analysis-bot-compact .analysis-bot-launcher-copy{flex:0 0 auto}
    #digitCircleAnalysisPanel .analysis-bot-compact .analysis-bot-launcher-copy strong{font-size:12px;color:#f5d58b}
    #digitCircleAnalysisPanel .analysis-bot-compact .panel-overline{font-size:8px;color:#e7bb5e}
    #digitCircleAnalysisPanel .analysis-bot-compact .analysis-bot-controls{display:flex;align-items:center;gap:6px;flex:1;flex-wrap:wrap}
    #digitCircleAnalysisPanel .analysis-bot-compact .analysis-bot-controls>label{font-size:9px;color:#bdc9d9;display:flex;align-items:center;gap:5px}
    #digitCircleAnalysisPanel .analysis-bot-compact select{min-height:29px;padding:4px 7px;font-size:10px;max-width:180px}
    #digitCircleAnalysisPanel .analysis-bot-compact .button{min-height:30px;padding:6px 10px;font-size:10px;white-space:nowrap}
    #digitCircleAnalysisPanel .analysis-bot-compact .form-footnote{flex-basis:100%;font-size:9px;margin:0;color:#8f9db0}
    #analysisStopBot:disabled{opacity:.45;cursor:not-allowed}
    @media(max-width:560px){#digitCircleAnalysisPanel .analysis-bot-compact{gap:7px;padding:8px}#digitCircleAnalysisPanel .analysis-bot-compact .analysis-bot-launcher-copy{width:100%}#digitCircleAnalysisPanel .analysis-bot-compact .analysis-bot-controls{gap:5px}#digitCircleAnalysisPanel .analysis-bot-compact .analysis-bot-controls select{max-width:135px}#digitCircleAnalysisPanel .analysis-bot-compact .button{padding:6px 8px}}
  `;
  document.head.appendChild(botPanelCss);
  const botRunButton=document.querySelector('#analysisRunBot');
  const botStopButton=document.querySelector('#analysisStopBot');
  const botStatus=document.querySelector('#digitCircleAnalysisPanel .analysis-bot-compact .panel-overline');
  botRunButton?.addEventListener('click',()=>{if(botStopButton)botStopButton.disabled=false;if(botStatus)botStatus.textContent='DEMO RUN REQUESTED';});
  botStopButton?.addEventListener('click',()=>{if(botStopButton)botStopButton.disabled=true;if(botStatus)botStatus.textContent='BOT CONTROL · STOPPED';});
  liveCss.textContent=`
    .analysis-view-chooser{margin:16px 0;display:grid;gap:12px;padding:16px;border:1px solid #293143;border-radius:14px;background:linear-gradient(135deg,#121a28,#0d121c)}
    .analysis-view-intro{display:flex;flex-direction:column;gap:4px}.analysis-view-intro strong{font-size:15px;color:#f1f4fb}.analysis-view-intro span{font-size:11px;color:#8e9ab0}
    .analysis-view-buttons{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.analysis-view-button{display:grid;grid-template-columns:34px 1fr;grid-template-rows:auto auto;column-gap:10px;align-items:center;text-align:left;padding:13px;border:1px solid #30394b;border-radius:11px;background:#0b1019;color:#c5cede;cursor:pointer}.analysis-view-button .view-button-icon{grid-row:1/3;display:grid;place-items:center;width:34px;height:34px;border-radius:9px;background:#1a2232;color:#a8b7d1;font-size:20px}.analysis-view-button strong{font-size:12px}.analysis-view-button small{font-size:10px;color:#8e9ab0;margin-top:3px}.analysis-view-button.active{border-color:#9a7bff;background:#211b36;box-shadow:0 0 0 1px #9a7bff22}.analysis-view-button.active .view-button-icon{background:#342853;color:#d9caff}.digit-circle-analysis-panel[hidden],.analysis-bot-launcher[hidden],.scanner-panel[hidden],.signal-summary-grid[hidden],.signals-table-panel[hidden]{display:none!important}
    @media(max-width:560px){.analysis-view-buttons{grid-template-columns:1fr}.analysis-view-button{padding:11px}}
    .live-digit-grid{display:grid;grid-template-columns:repeat(10,minmax(0,1fr));gap:7px;margin-top:15px}
    .live-digit{padding:9px 5px;background:#0d121c;border:1px solid #293143;border-radius:8px;text-align:center;min-width:0}
    .live-digit strong{display:block;font:700 16px var(--mono);color:#dcd5ff}
    .live-digit span,.live-digit small{display:block;font-size:9px;color:#8e9ab0}
    .live-digit i{display:block;height:3px;background:#293143;border-radius:5px;margin-top:7px;overflow:hidden}
    .live-digit i b{display:block;height:100%;background:#9a7bff}
    .live-digit-foot{font-size:9px;color:#6f7b92;margin-top:12px}
    .recent-live-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap;border-top:1px solid #252c3b;margin-top:14px;padding-top:13px;font-size:9px;color:#8b96aa}
    .recent-live-row>strong{color:#c8d0df}.recent-live-row>span{margin-left:auto}.recent-live-digits{display:flex;gap:5px;flex-wrap:wrap}
    .recent-live-digits span{width:24px;height:24px;display:grid;place-items:center;background:#22293a;border-radius:5px;color:#d8dff0;font:10px var(--mono)}
    @media(max-width:700px){.live-digit-grid{grid-template-columns:repeat(5,minmax(0,1fr))}.live-digit{padding:9px 3px}}
  `;
  liveCss.textContent += `
    .live-digit{border-radius:12px;padding:10px 5px 9px;background:#101622}
    .live-digit .digit-circle{display:grid;place-items:center;width:34px;height:34px;margin:0 auto 8px;border-radius:50%;font-size:14px;color:#08111a;border:2px solid #ffffff22}
    .live-digit.digit-green .digit-circle,.live-digit.digit-green .digit-bar-large b{background:#43d49a}.live-digit.digit-blue .digit-circle,.live-digit.digit-blue .digit-bar-large b{background:#54a8ff}
    .live-digit.digit-yellow .digit-circle,.live-digit.digit-yellow .digit-bar-large b{background:#f3c84b}.live-digit.digit-red .digit-circle,.live-digit.digit-red .digit-bar-large b{background:#ff647c}
    .live-digit.digit-green .digit-circle{box-shadow:0 0 0 3px #43d49a20}.live-digit.digit-blue .digit-circle{box-shadow:0 0 0 3px #54a8ff20}.live-digit.digit-yellow .digit-circle{box-shadow:0 0 0 3px #f3c84b20}.live-digit.digit-red .digit-circle{box-shadow:0 0 0 3px #ff647c20}
    .live-digit .digit-bar-small{height:3px;margin-top:7px}.live-digit .digit-bar-small b{background:#7c88a0}.live-digit .digit-bar-large{height:7px;margin-top:4px;background:#222b3a}.live-digit .digit-bar-large b{display:block;height:100%;border-radius:6px;opacity:.95}
    @media(max-width:700px){.live-digit .digit-circle{width:30px;height:30px}.live-digit{padding:8px 3px}}
  `;
  liveCss.textContent += `
    .analysis-tools{display:flex;flex-direction:column;gap:12px;margin:16px 0}.analysis-tools label{display:flex;align-items:center;gap:12px;color:#9aa7bd;font-size:11px}.analysis-tools select{max-width:220px}.analysis-mode-tabs{display:flex;gap:7px;flex-wrap:wrap}.analysis-mode{border:1px solid #30394b;background:#111824;color:#aeb9cb;border-radius:8px;padding:9px 12px;font-size:11px;cursor:pointer}.analysis-mode.active{border-color:#9a7bff;color:#e8e0ff;background:#211b36}.analysis-mode-summary{border:1px solid #293143;background:#0b1019;border-radius:10px;padding:12px;color:#d4dced;font-size:12px;margin-bottom:12px;min-height:40px}.live-digit.rank-top .digit-circle{background:#43d49a!important;border-color:#43d49a!important;color:#07130e}.live-digit.rank-second .digit-circle{background:#54a8ff!important;border-color:#54a8ff!important;color:#06111e}.live-digit.rank-bottom .digit-circle{background:#ff647c!important;border-color:#ff647c!important;color:#21070c}.live-digit.rank-second-bottom .digit-circle{background:transparent!important;border:3px solid #f3a64b!important;color:#f3c17c}.live-digit.rank-top .digit-bar-large b{background:#43d49a!important}.live-digit.rank-second .digit-bar-large b{background:#54a8ff!important}.live-digit.rank-bottom .digit-bar-large b{background:#ff647c!important}.live-digit.rank-second-bottom .digit-bar-large b{background:#f3a64b!important}
    .live-digit .digit-circle{width:38px;height:38px;font-weight:800}.live-digit strong{font-size:16px}.live-digit .rank-label{display:block;font-size:8px;min-height:12px;color:#c3ccdc;margin-top:3px}
    @media(max-width:700px){.analysis-tools label{align-items:flex-start;flex-direction:column}.analysis-mode{flex:1 1 42%;padding:9px 5px}.live-digit .digit-circle{width:32px;height:32px}}
  `;
  liveCss.textContent += `
    /* V15: compact, colourful analysis dashboard with the view switch always nearby. */
    #page-signals .page-heading{margin-bottom:8px;padding-bottom:6px}
    #page-signals .page-heading h1,#page-signals .page-heading h2{margin-bottom:3px}
    #page-signals .analysis-market-sync{margin:7px 0 9px;padding:10px 12px;border-radius:12px;border:1px solid #287c91;background:linear-gradient(110deg,#102b3b,#142033 58%,#211936)}
    #page-signals .analysis-market-sync>label{margin:0 0 5px;color:#7fe6ed;font-weight:800;letter-spacing:.04em}
    #page-signals .analysis-market-sync .dark-select{max-width:100%;border-color:#286b86;background:#0c1725}
    .analysis-view-chooser{position:sticky;top:58px;z-index:30;margin:7px 0 10px;padding:9px 10px;gap:7px;border-color:#2b5268;background:linear-gradient(115deg,rgba(13,39,54,.97),rgba(24,24,48,.97),rgba(43,24,46,.97));box-shadow:0 8px 22px #0005;backdrop-filter:blur(12px)}
    .analysis-view-intro{flex-direction:row;align-items:center;justify-content:space-between;gap:8px}.analysis-view-intro strong{font-size:13px;color:#f5f8ff}.analysis-view-intro span{font-size:10px;text-align:right}
    .analysis-view-buttons{gap:7px}.analysis-view-button{padding:8px 10px;min-height:54px;border-color:#31445d;background:linear-gradient(135deg,#101b2b,#151526);grid-template-columns:30px 1fr;column-gap:8px}
    .analysis-view-button[data-analysis-view="digits"] .view-button-icon{background:linear-gradient(135deg,#075e58,#19a78a);color:#d8fff4}
    .analysis-view-button[data-analysis-view="smart"] .view-button-icon{background:linear-gradient(135deg,#4b2e8d,#287bd1);color:#f1eaff}
    .analysis-view-button[data-analysis-view="digits"].active{border-color:#25d6b0;background:linear-gradient(120deg,#103c3a,#152b3d);box-shadow:0 0 0 1px #25d6b033}
    .analysis-view-button[data-analysis-view="smart"].active{border-color:#8d78ff;background:linear-gradient(120deg,#292052,#152b49);box-shadow:0 0 0 1px #8d78ff33}
    .analysis-view-button strong{font-size:12px;color:#f3f7ff}.analysis-view-button small{font-size:9px;line-height:1.3}
    #digitCircleAnalysisPanel{padding:13px;border-color:#276b72;background:linear-gradient(145deg,#101f2a,#111624 60%,#211a2b)}
    #digitCircleAnalysisPanel .panel-overline{color:#5ce0c2}#digitCircleAnalysisPanel h2{margin:4px 0;font-size:16px}
    #digitCircleAnalysisPanel .analysis-tools{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0}
    #digitCircleAnalysisPanel .analysis-tools label{display:flex;flex-direction:column;align-items:stretch;gap:5px;padding:8px;border:1px solid #273f55;border-radius:9px;background:#101c2a;color:#b7c9df}
    #digitCircleAnalysisPanel .analysis-tools select{width:100%;max-width:none;min-height:35px;border-color:#2b6b83}
    #digitCircleAnalysisPanel .analysis-mode-tabs{grid-column:1/-1;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}
    #digitCircleAnalysisPanel .analysis-mode{padding:8px 4px;font-size:10px;border-radius:8px;background:#142033;border-color:#30445d}
    #digitCircleAnalysisPanel .analysis-mode[data-analysis-mode="digits"].active{background:#12483f;border-color:#26d6ae;color:#baffed}
    #digitCircleAnalysisPanel .analysis-mode[data-analysis-mode="overunder"].active{background:#4b2d15;border-color:#ffb34d;color:#ffe0ae}
    #digitCircleAnalysisPanel .analysis-mode[data-analysis-mode="evenodd"].active{background:#172f58;border-color:#5aaaff;color:#d3e9ff}
    #digitCircleAnalysisPanel .analysis-mode[data-analysis-mode="risefall"].active{background:#4a1f36;border-color:#ff729f;color:#ffd5e2}
    #digitCircleAnalysisPanel .analysis-mode-summary{padding:9px 10px;min-height:0;border-color:#31475d;background:linear-gradient(100deg,#132d3c,#201a31);font-size:11px;margin-bottom:9px}
    #digitCircleAnalysisPanel .live-digit-grid{gap:5px;margin-top:8px}
    #digitCircleAnalysisPanel .live-digit{padding:7px 3px;background:linear-gradient(160deg,#17283a,#101722);border-color:#2b4058}
    #digitCircleAnalysisPanel .live-digit .digit-circle{display:flex!important;align-items:center!important;justify-content:center!important;box-sizing:border-box!important;width:36px!important;height:36px!important;min-width:36px!important;min-height:36px!important;aspect-ratio:1/1!important;border-radius:50%!important;margin:0 auto 7px!important;padding:0!important;line-height:1!important;flex:none!important}
    #digitCircleAnalysisPanel .live-digit-foot{line-height:1.45;color:#a5b5ca}
    #digitCircleAnalysisPanel .recent-live-row{margin-top:9px;padding-top:9px}
    @media(max-width:560px){
      .analysis-view-chooser{top:52px;padding:8px}
      .analysis-view-intro span{max-width:58%;font-size:9px}
      .analysis-view-buttons{grid-template-columns:repeat(2,minmax(0,1fr))}
      .analysis-view-button{grid-template-columns:26px 1fr;padding:7px 6px;min-height:51px;column-gap:6px}
      .analysis-view-button .view-button-icon{width:26px;height:26px;font-size:16px}
      .analysis-view-button strong{font-size:10px}.analysis-view-button small{font-size:8px}
      #digitCircleAnalysisPanel{padding:10px}
      #digitCircleAnalysisPanel .panel-heading{gap:7px;align-items:flex-start}
      #digitCircleAnalysisPanel .demo-pill{font-size:7px;padding:4px 5px}
      #digitCircleAnalysisPanel .analysis-mode{font-size:9px;padding:8px 2px}
      #digitCircleAnalysisPanel .live-digit .digit-circle{width:30px!important;height:30px!important;min-width:30px!important;min-height:30px!important}
      #digitCircleAnalysisPanel .live-digit strong{font-size:13px}
      #digitCircleAnalysisPanel .live-digit span,#digitCircleAnalysisPanel .live-digit small{font-size:8px}
    }
    /* V16: market selector lives inside frequency panel; contract types are not digit labels. */
    #digitCircleAnalysisPanel .analysis-market-inline{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:8px;margin:9px 0;padding:7px 9px;border:1px solid #287c91;border-radius:9px;background:linear-gradient(100deg,#102b3b,#142033 65%,#211936)}
    #digitCircleAnalysisPanel .analysis-market-inline label{font-size:9px;font-weight:800;letter-spacing:.08em;color:#70e2df}
    #digitCircleAnalysisPanel .analysis-market-inline select{width:100%;min-width:0;max-width:none;min-height:31px;padding:5px 8px;font-size:11px;border-color:#286b86;background:#0c1725}
    #digitCircleAnalysisPanel .analysis-market-inline .template-tag{font-size:7px;white-space:nowrap;padding:4px 5px}
    #digitCircleAnalysisPanel .analysis-mode[data-analysis-mode="overunder"].active{background:#4b2d15;border-color:#ffb34d;color:#ffe0ae}
    #digitCircleAnalysisPanel .analysis-mode[data-analysis-mode="evenodd"].active{background:#172f58;border-color:#5aaaff;color:#d3e9ff}
    #digitCircleAnalysisPanel .analysis-mode[data-analysis-mode="risefall"].active{background:#12483f;border-color:#26d6ae;color:#baffed}
    #digitCircleAnalysisPanel .analysis-mode[data-analysis-mode="matchesdiffers"].active{background:#4a1f36;border-color:#ff729f;color:#ffd5e2}
    @media(max-width:560px){#digitCircleAnalysisPanel .analysis-market-inline{grid-template-columns:auto minmax(0,1fr);gap:6px;padding:6px 7px}#digitCircleAnalysisPanel .analysis-market-inline .template-tag{display:none}#digitCircleAnalysisPanel .analysis-market-inline select{font-size:10px;min-height:29px}}
  `;
  document.head.appendChild(liveCss);
  setStatus(false, "Connecting to Deriv…");
  connect();
  // Give every market dropdown on the site the full Volatility + Jump list (grouped), keeping its current choice.
  function expandMarketSelects() {
    const names = Object.keys(markets);
    const vol = names.filter(n => n.startsWith("Volatility")), jump = names.filter(n => n.startsWith("Jump"));
    $$("select").forEach(sel => {
      const opts = [...sel.options];
      if (!opts.length || sel.id === "analysisMarketSelect" || !opts.every(o => /^(Volatility|Jump) .* Index$/.test(o.textContent.trim()))) return;
      const keep = sel.value;
      const group = (label, list) => '<optgroup label="' + label + '">' + list.map(n => '<option>' + n + '</option>').join("") + "</optgroup>";
      sel.innerHTML = group("Volatility Indices", vol) + group("Jump Indices", jump);
      sel.value = names.includes(keep) ? keep : (names.includes(state.selected) ? state.selected : names[0]);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", expandMarketSelects); else expandMarketSelects();
})();
// V17 fix: delegated market selector remains functional after it is moved into the frequency panel; force true circular digit badges on mobile and desktop.
