'use strict';
/* Public, read-only dashboard. All data is loaded from local JSON files.
   The timestamps in the Raspberry Pi export are Asia/Shanghai local time (UTC+08:00). */
const METRICS = {
  water: {source:'water_temp', field:'temperature_c', label:'海水温度', unit:'°C', color:'#075b9b', digits:2},
  enclosure_temperature: {source:'dht22', field:'enclosure_temperature_c', label:'浮台腔体内温度', unit:'°C', color:'#2588a9', digits:1},
  humidity: {source:'dht22', field:'enclosure_humidity_pct', label:'相对湿度', unit:'%RH', color:'#268c91', digits:1},
  light: {source:'light', field:'illuminance_lux', label:'光照度', unit:'Lux', color:'#be8b37', digits:0},
  soc: {source:'inverter', field:'battery_soc_est_pct', label:'估算 SOC', unit:'%', color:'#1b8397', digits:2},
  pv: {source:'inverter', field:'pv_power_w', label:'光伏发电功率', unit:'W', color:'#1a8e84', digits:1},
  ac: {source:'inverter', field:'ac_output_power_w', label:'交流输出功率', unit:'W', color:'#075b9b', digits:1},
};
const SOURCE_LABELS = {
  water_temp:'DS18B20 海水温度', dht22:'DHT22 腔体温湿度',
  light:'光照传感器', inverter:'SP-4862 逆变器',
};
const $ = id => document.getElementById(id);
let latest = null;
let history = null;
const isNumber = n => typeof n === 'number' && Number.isFinite(n);
function fmt(n, digits=1){return isNumber(n) ? Number(n).toLocaleString('zh-CN',{maximumFractionDigits:digits,minimumFractionDigits:0}) : '—';}
function getSensor(name){return latest?.sensors?.[name] ?? null;}
function getValue(name,key){let v=getSensor(name)?.values?.[key]; return isNumber(v)?v:null;}
function parseTime(s){
  if (typeof s!=='string'||!s.trim())return null;
  // Exports contain timezone-naive local time (China standard time).
  const normal=s.trim().replace(' ','T');
  const complete=/[zZ]$|[+-]\d\d:\d\d$/.test(normal)?normal:normal+'+08:00';
  const dt=new Date(complete);
  return Number.isFinite(dt.valueOf())?dt:null;
}
const shortFormatter=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
const longFormatter=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
function timeStr(s,short=false){const d=parseTime(s);if(!d)return '—';return (short?shortFormatter:longFormatter).format(d).replaceAll('/','-');}
function setText(id,value){let el=$(id); if(el)el.textContent=value;}
function sourceStatus(status){return status==='ok'?'数据较新':status==='stale'?'历史数据':'暂无数据';}
function setStatus(id,source){const el=$(id);if(!el)return;const status=getSensor(source)?.status||'no_data';el.textContent=sourceStatus(status);el.className='metric-trend '+(status==='ok'?'':status==='stale'?'stale':'no_data');}
function setMetric(valueID,stampID,source,key,digits){
  setText(valueID,fmt(getValue(source,key),digits));
  if(stampID)setText(stampID,'采集：'+timeStr(getSensor(source)?.sample_time));
}
function renderLatest(){
  setText('through-time',timeStr(latest.data_through)+'（UTC+8）');
  setMetric('value-water','stamp-water','water_temp','temperature_c',2);
  setMetric('value-light','stamp-light','light','illuminance_lux',0);
  setMetric('value-pv','stamp-pv','inverter','pv_power_w',1);
  setMetric('value-soc','stamp-soc','inverter','battery_soc_est_pct',2);
  for (const s of ['water_temp','dht22','light','inverter']) setStatus('status-'+s,s);
  const env = [
    ['env-water','env-water-time','water_temp','temperature_c',2],
    ['env-air','env-air-time','dht22','enclosure_temperature_c',1],
    ['env-humidity','env-humidity-time','dht22','enclosure_humidity_pct',1],
    ['env-light','env-light-time','light','illuminance_lux',0],
  ];
  for(const [valueID,timeID,source,key,digits] of env)setMetric(valueID,timeID,source,key,digits);
  const inv = [
    ['energy-soc','battery_soc_est_pct',2],['energy-vbat','battery_voltage_v',1],
    ['energy-ibat','battery_current_a',2],['energy-pbat','battery_power_w',1],
    ['energy-ppv','pv_power_w',1],['energy-vpv','pv_voltage_v',1],
    ['energy-vac','ac_output_voltage_v',1],['energy-pac','ac_output_power_w',1],
    ['energy-kwh','total_generation_kwh',2]
  ];
  for(const [id,key,digits] of inv)setText(id,fmt(getValue('inverter',key),digits));
  const soc=getValue('inverter','battery_soc_est_pct');
  $('soc-progress').style.width=isNumber(soc)?Math.max(0,Math.min(100,soc))+'%':'0%';
  const list=$('sensor-list');list.replaceChildren();
  Object.entries(SOURCE_LABELS).forEach(([source,label])=>{
    const s=getSensor(source)||{status:'no_data'};
    const row=document.createElement('div');row.className='sensor-row';
    const n=document.createElement('span');n.className='sensor-name';n.textContent=label;
    const t=document.createElement('span');t.className='sensor-time';t.textContent=timeStr(s.sample_time,true);
    const pill=document.createElement('span');pill.className='pill '+(s.status||'no_data');pill.textContent=sourceStatus(s.status);
    row.append(n,t,pill);list.append(row);
  });
  renderRecordSummary();
}
function svgEl(tag,attrs={},text){
  const node=document.createElementNS('http://www.w3.org/2000/svg',tag);
  for(const [key,val] of Object.entries(attrs))node.setAttribute(key,String(val));
  if(text!==undefined)node.textContent=text;
  return node;
}
function metricPoints(metric){
  const m=METRICS[metric];if(!m)return [];
  const rows=history?.series?.[m.source];if(!Array.isArray(rows))return [];
  return rows.map(item=>({ms:parseTime(item?.time)?.getTime(),v:item?.[m.field]}))
    .filter(p=>Number.isFinite(p.ms)&&isNumber(p.v)).sort((a,b)=>a.ms-b.ms);
}
function niceNumber(n){if(!Number.isFinite(n))return '—'; if(Math.abs(n)>=1000)return fmt(n,0);if(Math.abs(n)>=100)return fmt(n,1);if(Math.abs(n)>=10)return fmt(n,1);return fmt(n,2);}
function drawChart(id,metricNames){
  const holder=$(id);if(!holder)return;
  holder.replaceChildren();
  const datasets=metricNames.map(name=>({name,...METRICS[name],points:metricPoints(name)})).filter(x=>x.points.length);
  if(!datasets.length){const empty=document.createElement('div');empty.className='empty-chart';empty.textContent='当前时间范围内没有可绘制的数据';holder.append(empty);return;}
  const W=680,H=id==='chart-energy'||id==='chart-records'?305:240;
  const left=55,right=15,top=24,bottom=47;
  const pw=W-left-right,ph=H-top-bottom;
  const points=datasets.flatMap(x=>x.points);
  let xmin=Math.min(...points.map(x=>x.ms)),xmax=Math.max(...points.map(x=>x.ms));
  const start=parseTime(history?.window_start)?.getTime();
  const end=parseTime(history?.data_through)?.getTime();
  // Fix the x domain to the seven-day archive, so sparse datasets do not look dense.
  if(Number.isFinite(start)&&Number.isFinite(end)&&end>start){xmin=start;xmax=end;}
  else if(xmin===xmax){xmin-=3600000;xmax+=3600000;}
  let ymin=Math.min(...points.map(x=>x.v)),ymax=Math.max(...points.map(x=>x.v));
  const range=ymax-ymin;const pad=range>0?range*.17:Math.max(Math.abs(ymin)*.1,1);
  ymin-=pad;ymax+=pad;
  if(ymin>0 && ymin<Math.abs(ymax)*.08)ymin=0;
  const x=ms=>left+(ms-xmin)/(xmax-xmin)*pw;
  const y=v=>top+(ymax-v)/(ymax-ymin)*ph;
  const svg=svgEl('svg',{viewBox:`0 0 ${W} ${H}`,role:'img','aria-label':datasets.map(d=>d.label).join('、')+'，近七天数据曲线',preserveAspectRatio:'none'});
  const grid=svgEl('g');
  for(let i=0;i<=4;i++){
    const gy=top+i*ph/4;
    grid.append(svgEl('line',{x1:left,y1:gy,x2:W-right,y2:gy,stroke:'#e8eff4','stroke-width':'1'}));
    grid.append(svgEl('text',{x:left-10,y:gy+4,'text-anchor':'end',fill:'#90a4b4','font-size':'11'},niceNumber(ymax-i*(ymax-ymin)/4)));
  }
  for(let i=0;i<=4;i++){
    const ms=xmin+i*(xmax-xmin)/4;
    grid.append(svgEl('line',{x1:x(ms),y1:top,x2:x(ms),y2:top+ph,stroke:'#f3f6f8','stroke-width':'1'}));
    const label=shortFormatter.format(new Date(ms)).replaceAll('/','-').replace(', ',' ');
    grid.append(svgEl('text',{x:x(ms),y:H-19,'text-anchor':'middle',fill:'#95a5b1','font-size':'10'},label));
  }
  svg.append(grid);
  datasets.forEach(d=>{
    let path='',prev=null;
    for(const p of d.points){
      const xx=x(p.ms),yy=y(p.v);
      // No invented measurements: split lines across gaps >2.5 hours.
      const separated=!prev||(p.ms-prev.ms)>2.5*60*60*1000;
      path+=(separated?'M':'L')+xx.toFixed(2)+','+yy.toFixed(2)+' ';
      prev=p;
    }
    svg.append(svgEl('path',{d:path,fill:'none',stroke:d.color,'stroke-width':'2.3','stroke-linejoin':'round','stroke-linecap':'round','vector-effect':'non-scaling-stroke'}));
    d.points.forEach(p=>{
      const r=svgEl('circle',{cx:x(p.ms),cy:y(p.v),r:d.points.length<=10?'4.2':'3.1',fill:d.color,stroke:'#fff','stroke-width':d.points.length<=10?'1.5':'.7',opacity:d.points.length<=70?'1':'0.9'});
      r.append(svgEl('title',{},`${d.label}\n${timeStr(new Date(p.ms).toISOString())}\n${fmt(p.v,d.digits)} ${d.unit}`));
      svg.append(r);
    });
  });
  holder.append(svg);
  if(metricNames.length>1){
    const legend=document.createElement('div');legend.className='chart-legend';
    legend.style.cssText='display:flex;justify-content:flex-end;align-items:center;gap:18px;position:absolute;top:0;right:12px;pointer-events:none;font-size:10px;color:#8093a1';
    datasets.forEach(d=>{const e=document.createElement('span');e.style.display='inline-flex';e.style.alignItems='center';e.style.gap='5px';const sw=document.createElement('i');sw.style.cssText='display:block;width:14px;height:3px;border-radius:3px;background:'+d.color;e.append(sw,document.createTextNode(d.label));legend.append(e);});
    holder.append(legend);
  }
}
function renderRecordSummary(){
  const root=$('record-summary');if(!root)return;root.replaceChildren();
  const fields=[
    ['数据更新截止',timeStr(latest?.data_through)],
    ['上次 JSON 生成',timeStr(latest?.generated_at)],
    ['历史窗口起点',timeStr(history?.window_start)],
    ['采样汇总',Object.values(history?.series||{}).reduce((n,rows)=>n+(Array.isArray(rows)?rows.length:0),0)+' 条小时记录']
  ];
  fields.forEach(([title,value])=>{const card=document.createElement('div');card.className='record-item';const a=document.createElement('span');a.textContent=title;const b=document.createElement('strong');b.textContent=value;card.append(a,b);root.append(card);});
}
function renderCharts(){
  drawChart('chart-home-water',['water']);
  drawChart('chart-home-energy',['pv','ac']);
  drawChart('chart-env-water',['water']);
  drawChart('chart-env-air',['enclosure_temperature']);
  drawChart('chart-env-humidity',['humidity']);
  drawChart('chart-env-light',['light']);
  drawChart('chart-energy',['pv','ac']);
  const selected=$('metric-select').value;
  drawChart('chart-records',[selected]);
  const points=metricPoints(selected);
  setText('record-meta',`当前变量：${METRICS[selected].label}；有效小时记录数：${points.length}。曲线仅使用实际记录，不插值补全缺测时段。`);
}
function showPage(page){
  if(!['overview','environment','energy','records'].includes(page))page='overview';
  document.querySelectorAll('[data-panel]').forEach(el=>el.hidden=el.dataset.panel!==page);
  document.querySelectorAll('button[data-nav]').forEach(btn=>{
    const active=btn.dataset.nav===page;
    btn.classList.toggle('active',active);
    if(active)btn.setAttribute('aria-current','page');else btn.removeAttribute('aria-current');
  });
  if(latest&&history)renderCharts();
}
// 防止自动刷新与手动刷新同时执行
let refreshInProgress = false;

// 获取最新数据
async function fetchData(options = {}) {
  const silent = options?.silent === true;

  if (refreshInProgress) return;

  refreshInProgress = true;

  const refreshBtn = $('refresh-btn');
  const loadingAlert = $('loading-alert');
  const errorAlert = $('error-alert');

  if (refreshBtn) refreshBtn.disabled = true;

  if (!silent) {
    errorAlert?.classList.add('hidden');
    loadingAlert?.classList.remove('hidden');
  }

  try {
    // 每次请求添加时间参数，避免 CDN 或浏览器返回旧缓存
    const latestUrl = './data/latest.json?t=' + Date.now();

    const response = await fetch(latestUrl, {
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(
        `最新数据读取失败（HTTP ${response.status}）`
      );
    }

    const newLatest = await response.json();

    if (!newLatest?.sensors) {
      throw new Error('latest.json 数据结构不正确');
    }

    // 判断数据是否真正发生更新
    const dataChanged =
      !latest ||
      !history ||
      newLatest.generated_at !== latest.generated_at ||
      newLatest.data_through !== latest.data_through;

    if (!dataChanged) {
      errorAlert?.classList.add('hidden');
      return;
    }

    console.log(
      '[AUTO UPDATE] 发现新数据:',
      newLatest.generated_at
    );

    // 只有发现新数据时，才下载较大的历史文件
    const historyUrl = './data/history.json?t=' + Date.now();

    const historyResponse = await fetch(historyUrl, {
      cache: 'no-store'
    });

    if (!historyResponse.ok) {
      throw new Error(
        `历史数据读取失败（HTTP ${historyResponse.status}）`
      );
    }

    const newHistory = await historyResponse.json();

    if (!newHistory?.series) {
      throw new Error('history.json 数据结构不正确');
    }

    // 两份数据均成功读取后，再统一更新页面
    latest = newLatest;
    history = newHistory;

    renderLatest();
    renderCharts();

    errorAlert?.classList.add('hidden');

    console.log(
      '[AUTO UPDATE] 页面更新完成:',
      latest.generated_at
    );

  } catch (error) {

    console.error('[AUTO UPDATE ERROR]', error);

    if (errorAlert) {
      errorAlert.classList.remove('hidden');

      const message = latest && history
        ? '自动更新暂时失败，当前保留上次成功获取的数据：'
        : '无法加载公开监测数据：';

      errorAlert.textContent =
        message +
        (error?.message || String(error)) +
        '。系统将在下次自动检查时重试。';
    }

  } finally {

    loadingAlert?.classList.add('hidden');

    if (refreshBtn) refreshBtn.disabled = false;

    refreshInProgress = false;
  }
}


// 页面初始化
window.addEventListener('DOMContentLoaded', () => {

  document.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', event => {
      event.preventDefault();

      showPage(el.dataset.nav);

      if (el.tagName !== 'A') {
        window.scrollTo({
          top: 0,
          behavior: 'smooth'
        });
      }
    });
  });

  // 保留手动刷新功能
  $('refresh-btn').addEventListener('click', () => {
    fetchData();
  });

  // 保留历史变量切换功能
  $('metric-select').addEventListener('change', () => {
    if (history) renderCharts();
  });

  showPage('overview');

  // 网页首次打开立即获取数据
  fetchData();

  // 每5分钟自动检查一次
  window.setInterval(() => {
    fetchData({ silent: true });
  }, 5 * 60 * 1000);

  console.log('[AUTO UPDATE] 已启用，每5分钟检查一次');

});
