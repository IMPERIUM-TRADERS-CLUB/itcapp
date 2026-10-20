(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const market = $('speedBotMarket');
  if (!market) return;
  const state = { running:false, count:0, batches:0, tickets:0, digits:[], last:null, previous:null, lastEligibleEpoch:null, seen:0, log:[] };
  const fmt = n => Number(n).toLocaleString('en-US',{maximumFractionDigits:8});
  const stamp = () => new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});
  function addLog(message, detail='') {
    state.log.unshift({message,detail,time:stamp()}); state.log=state.log.slice(0,24);
    $('speedBotLog').innerHTML=state.log.map(x=>`<div class="speedbot-log-item"><strong>${x.time}</strong> · ${x.message}${x.detail?`<small>${x.detail}</small>`:''}</div>`).join('');
  }
  function updateRule(){
    const type=$('speedBotContract').value, barrier=Number($('speedBotBarrier').value), names={DIGITOVER:'Over',DIGITUNDER:'Under',DIGITEVEN:'Even',DIGITODD:'Odd',DIGITMATCH:'Matches',DIGITDIFF:'Differs',CALL:'Rise',PUT:'Fall'};
    $('speedBotRuleNote').textContent = ['DIGITOVER','DIGITUNDER','DIGITMATCH','DIGITDIFF'].includes(type) ? `Entry watch: ${names[type]} ${barrier} — ${type==='DIGITOVER'?'look for a last digit above':type==='DIGITUNDER'?'look for a last digit below':type==='DIGITMATCH'?'look for a last digit equal to':'look for a last digit different from'} ${barrier}.` : `Entry watch: ${names[type]} — observe the latest tick and review the rule before any trading decision.`;
  }
  function qualifies(d, prev) {
    const type=$('speedBotContract').value, b=Number($('speedBotBarrier').value);
    if(type==='DIGITOVER')return d>b; if(type==='DIGITUNDER')return d<b;
    if(type==='DIGITEVEN')return d%2===0; if(type==='DIGITODD')return d%2===1;
    if(type==='DIGITMATCH')return d===b; if(type==='DIGITDIFF')return d!==b;
    if(type==='CALL')return prev!==null && d>prev; if(type==='PUT')return prev!==null && d<prev;
    return false;
  }
  function renderDigitStrip(){
    const strip=$('speedBotDigitStrip');
    strip.innerHTML=state.digits.length?state.digits.slice(0,14).reverse().map((x,i)=>`<span class="speedbot-digit ${i===state.digits.length-1?'latest':''}">${x}</span>`).join(''):'<span class="speedbot-empty">Waiting for live ticks…</span>';
    $('speedBotLastDigit').textContent=state.last===null?'—':state.last;
    $('speedBotPreviousDigit').textContent=state.previous===null?'—':state.previous;
    $('speedBotTickCount').textContent=state.count.toLocaleString();
  }
  function batch(d,epoch){
    if(!state.running)return;
    if(!qualifies(d,state.previous)){$('speedBotRuleState').textContent='Not met';return;}
    if(state.lastEligibleEpoch===epoch)return;
    state.lastEligibleEpoch=epoch;
    const n=Math.max(1,Math.min(10,Math.floor(Number($('speedBotTrades').value)||1)));
    const stake=Math.max(.35,Number($('speedBotStake').value)||.35);
    state.batches++;state.tickets+=n;
    $('speedBotBatches').textContent=state.batches;$('speedBotTickets').textContent=state.tickets;
    $('speedBotExposure').textContent='$'+(n*stake).toFixed(2);$('speedBotRuleState').textContent='Matched';
    addLog(`Eligible tick · digit ${d}`,`${n} simulated ticket${n===1?'':'s'} planned · $${stake.toFixed(2)} each · total planned stake $${(n*stake).toFixed(2)}. No order sent.`);
    if(!$('speedBotContinuous').checked){state.running=false;$('speedBotRunState').textContent='ONE BATCH DONE';$('speedBotStart').disabled=false;$('speedBotStop').disabled=true;}
  }
  function processMarketData(){
    const bridge=window.ITC_MARKET_DATA;
    if(!bridge){$('speedBotConnection').textContent='Market feed bridge unavailable. Check the public Deriv connection.';return;}
    const status=bridge.getStatus();
    const found=bridge.getMarkets().find(m=>m.name===market.value);
    $('speedBotMarketTitle').textContent=market.value;
    $('speedBotConnection').textContent=status.connected?'Connected to public Deriv ticks · read-only':'Waiting for public Deriv tick connection…';
    if(!found || !found.ticks.length)return;
    const ticks=found.ticks.slice(-60), latest=ticks[ticks.length-1];
    $('speedBotQuote').textContent=fmt(latest.price);
    // Deriv's public market bridge supplies the digit extracted from the quote precision.
    const fresh=ticks.filter(t=>Number(t.epoch)>state.seen);
    if(!state.count && ticks.length){const last=latest;state.last=Number(last.digit);state.previous=ticks.length>1?Number(ticks[ticks.length-2].digit):null;state.digits=ticks.slice(-14).map(t=>Number(t.digit));state.count=ticks.length;state.seen=Number(latest.epoch)||0;renderDigitStrip();return;}
    fresh.forEach(t=>{const d=Number(t.digit);state.previous=state.last;state.last=d;state.digits.push(d);state.digits=state.digits.slice(-14);state.count++;state.seen=Math.max(state.seen,Number(t.epoch)||0);renderDigitStrip();batch(d,Number(t.epoch));});
  }
  $('speedBotStart').addEventListener('click',()=>{const n=Math.floor(Number($('speedBotTrades').value));const stake=Number($('speedBotStake').value);const tp=Number($('speedBotTP').value),sl=Number($('speedBotSL').value);if(!Number.isFinite(n)||n<1||n>10){addLog('Check settings','Trades per tick must be between 1 and 10.');return;}if(!Number.isFinite(stake)||stake<.35||!Number.isFinite(tp)||tp<=0||!Number.isFinite(sl)||sl<=0){addLog('Check risk settings','Stake must be at least $0.35 and take-profit/stop-loss must be positive.');return;}state.running=true;state.lastEligibleEpoch=null;$('speedBotRunState').textContent='WATCHING';$('speedBotStart').disabled=true;$('speedBotStop').disabled=false;$('speedBotRuleState').textContent='Watching';addLog('Tick watch started',`${market.value} · ${$('speedBotContract').selectedOptions[0].text} ${$('speedBotBarrier').value} · continuous ${$('speedBotContinuous').checked?'on':'off'}. Simulation only.`);processMarketData();});
  $('speedBotStop').addEventListener('click',()=>{state.running=false;$('speedBotRunState').textContent='STOPPED';$('speedBotStart').disabled=false;$('speedBotStop').disabled=true;addLog('Emergency stop activated','Tick monitoring may continue visually, but no more simulated batches will be counted.');});
  [market,$('speedBotContract'),$('speedBotBarrier')].forEach(el=>el.addEventListener('change',()=>{updateRule();if(el===market){const bridge=window.ITC_MARKET_DATA;if(bridge)bridge.selectMarket(market.value);state.digits=[];state.last=null;state.previous=null;state.count=0;state.seen=0;renderDigitStrip();processMarketData();}}));
  $('speedBotTrades').addEventListener('input',()=>{$('speedBotExposure').textContent='$'+(Math.max(1,Math.min(10,Math.floor(Number($('speedBotTrades').value)||1)))*Math.max(.35,Number($('speedBotStake').value)||.35)).toFixed(2);});
  $('speedBotStake').addEventListener('input',()=>{$('speedBotExposure').textContent='$'+(Math.max(1,Math.min(10,Math.floor(Number($('speedBotTrades').value)||1)))*Math.max(.35,Number($('speedBotStake').value)||.35)).toFixed(2);});
  updateRule();renderDigitStrip();setInterval(processMarketData,300);
})();
