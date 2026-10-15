// Configuration (change as needed)
const ESP32_IP = "192.168.1.20";
const MUD_BALL_PER_M2 = 5;
const UPDATE_INTERVAL = 1000; // ms

// Turbidity thresholds (change after calibration)
// Do not treat these as final — adjust per calibration
// Default values adjusted for easier tuning; change as needed.
const TURBIDITY_THRESHOLDS = {
  jernih: 10,      // <= 10 NTU -> JERNIH
  agakKeruh: 25    // >10 and <=25 -> AGAK KERUH ; >25 -> KERUH
};
// Expose thresholds at runtime for quick adjustment in browser console:
// e.g. window.TURBIDITY_THRESHOLDS.jernih = 8
window.TURBIDITY_THRESHOLDS = TURBIDITY_THRESHOLDS;

// Limits
const MAX_HISTORY = 200;
const MAX_CHART_POINTS = 50;

// State
let demoMode = false;
let connected = false;
let fetchTimer = null;
let dispenserPoll = null;

// Arduino Uno via Web Serial (Chrome/Edge desktop)
let arduinoMode = false;
let serialPort = null;
let serialReader = null;
let serialBuffer = '';

// DOM
const espStatusEl = document.getElementById('espStatus');
const demoToggle = document.getElementById('demoToggle');
const connectArduinoBtn = document.getElementById('connectArduino');
const turbidityValueEl = document.getElementById('turbidityValue');
const adcValueEl = document.getElementById('adcValue');
const voltageValueEl = document.getElementById('voltageValue');
const updateTimeEl = document.getElementById('updateTime');
const statusTextEl = document.getElementById('statusText');
const statusDotEl = document.getElementById('statusDot');
const voltageBigEl = document.getElementById('voltageBig');

const areaInput = document.getElementById('areaInput');
const mudballTargetEl = document.getElementById('mudballTarget');
const areaErrorEl = document.getElementById('areaError');

const dispTargetEl = document.getElementById('dispTarget');
const dispReleasedEl = document.getElementById('dispReleased');
const dispRemainingEl = document.getElementById('dispRemaining');
const dispProgressEl = document.getElementById('dispProgress');
const processStatusEl = document.getElementById('processStatus');
const startDispenseBtn = document.getElementById('startDispense');
const stopDispenseBtn = document.getElementById('stopDispense');
const resetDispenseBtn = document.getElementById('resetDispense');

const historyTableBody = document.querySelector('#historyTable tbody');

// Chart.js setup
const chartCanvas = document.getElementById('turbidityChart');
const ctx = chartCanvas ? chartCanvas.getContext('2d') : null;
const chartData = {labels:[],datasets:[{label:'Turbidity (NTU)',data:[],borderColor:'rgba(46,139,87,0.9)',backgroundColor:'rgba(46,139,87,0.15)',tension:0.25}]};
const chartOptions = {responsive:true,maintainAspectRatio:false,scales:{x:{title:{display:true,text:'Time'}},y:{title:{display:true,text:'NTU'}}}};
let turbidityChart;
if (typeof Chart !== 'undefined' && ctx) {
  turbidityChart = new Chart(ctx,{type:'line',data:chartData,options:chartOptions});
} else {
  console.warn('Chart.js tidak termuat; dashboard berjalan tanpa grafik.');
  const chartCard = document.querySelector('.chart-card');
  if (chartCard) {
    const notice = document.createElement('p');
    notice.className = 'chart-warning';
    notice.textContent = 'Grafik tidak tersedia. Periksa koneksi internet, lalu muat ulang halaman.';
    chartCard.appendChild(notice);
  }
  turbidityChart = {
    options:{scales:{x:{title:{text:'Time'}},y:{title:{text:'NTU'}}}},
    update:function(){}
  };
}

// History storage
function loadHistory(){
  try{
    const raw = localStorage.getItem('wqm_history');
    return raw?JSON.parse(raw):[];
  }catch(e){return[]}
}
function saveHistory(arr){ localStorage.setItem('wqm_history',JSON.stringify(arr.slice(-MAX_HISTORY))); }

function addHistoryEntry(entry){
  const h = loadHistory();
  h.push(entry);
  saveHistory(h);
  renderHistory();
}

function renderHistory(){
  const h = loadHistory().slice().reverse();
  historyTableBody.innerHTML = '';
  for(const row of h){
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${row.time}</td><td>${row.adc}</td><td>${row.voltage} V</td><td>${row.turbidity} NTU</td><td>${row.status}</td>`;
    historyTableBody.appendChild(tr);
  }
}

// Utility
function nowTime(){ const d = new Date(); return d.toLocaleTimeString(); }

function setESPStatus(isConnected, mode){
  connected = isConnected;
  if(mode==='DEMO'){
    espStatusEl.textContent = '● DEMO MODE';
    espStatusEl.className = 'status connected';
    return;
  }
  if(arduinoMode){
    espStatusEl.textContent = isConnected ? '● ARDUINO UNO CONNECTED' : '● ARDUINO UNO DISCONNECTED';
    espStatusEl.className = isConnected ? 'status connected' : 'status disconnected';
    return;
  }
  if(isConnected){ espStatusEl.textContent = '● ESP32 CONNECTED'; espStatusEl.className='status connected'; }
  else{ espStatusEl.textContent = '● ESP32 DISCONNECTED'; espStatusEl.className='status disconnected'; }
}

function determineWaterStatus(turb){
  if(turb==null || isNaN(turb)) return 'UNKNOWN';
  if(turb <= TURBIDITY_THRESHOLDS.jernih) return 'JERNIH';
  if(turb <= TURBIDITY_THRESHOLDS.agakKeruh) return 'AGAK KERUH';
  return 'KERUH';
}

function updateStatusIndicator(status){
  statusTextEl.textContent = status;
  if(status==='JERNIH'){ statusDotEl.style.background='#2e8b57'; }
  else if(status==='AGAK KERUH'){ statusDotEl.style.background='#e0a400'; }
  else if(status==='KERUH'){ statusDotEl.style.background='#c04747'; }
  else { statusDotEl.style.background='#999'; }
}

// Area input logic
function computeMudballs(){
  const v = parseFloat(areaInput.value);
  if(isNaN(v)){
    areaErrorEl.textContent = 'Input harus berupa angka.'; return null;
  }
  if(v<=0){ areaErrorEl.textContent = 'Luas area harus lebih besar dari 0.'; return null; }
  areaErrorEl.textContent = '';
  const jumlah = Math.round(v * MUD_BALL_PER_M2);
  mudballTargetEl.textContent = jumlah;
  dispTargetEl.textContent = jumlah;
  updateDispenserStateFromStatus();
  return jumlah;
}

areaInput.addEventListener('input',()=>{ computeMudballs(); });

// Dispenser state and simulation
let dispenserState = {target:0,released:0,remaining:0,progress:0,status:'READY'};

function updateDispenserUI(){
  const arduinoOnly = arduinoMode && !demoMode;
  dispTargetEl.textContent = dispenserState.target;
  dispReleasedEl.textContent = dispenserState.released;
  dispRemainingEl.textContent = dispenserState.remaining;
  dispProgressEl.textContent = dispenserState.progress + '%';
  processStatusEl.textContent = dispenserState.status;
  startDispenseBtn.disabled = arduinoOnly || (dispenserState.target<=0) || (areaInput.value===''|| areaInput.value==='0');
  stopDispenseBtn.disabled = arduinoOnly;
  resetDispenseBtn.disabled = arduinoOnly;
}

function updateDispenserStateFromStatus(){
  const t = parseInt(dispTargetEl.textContent)||0;
  dispenserState.target = t;
  dispenserState.remaining = Math.max(0, dispenserState.target - dispenserState.released);
  dispenserState.progress = dispenserState.target?Math.round((dispenserState.released/dispenserState.target)*100):0;
  updateDispenserUI();
}

function startDispensing(){
  if(dispenserState.target<=0) return;
  if(demoMode){
    dispenserState.status='DISPENSING';
    updateDispenserUI();
    // demo: increment released every second
    if(dispenserPoll) clearInterval(dispenserPoll);
    dispenserPoll = setInterval(()=>{
      if(dispenserState.released < dispenserState.target){
        dispenserState.released += 1;
        updateDispenserStateFromStatus();
      }else{
        dispenserState.status='COMPLETED';
        updateDispenserStateFromStatus();
        clearInterval(dispenserPoll);
        dispenserPoll = null;
      }
    }, 1000);
  }else{
    // real mode: POST to ESP32
    fetch(`http://${ESP32_IP}/dispense/start`,{method:'POST'}).then(()=>{
      dispenserState.status='DISPENSING'; updateDispenserUI();
    }).catch(err=>{
      dispenserState.status='ERROR'; updateDispenserUI(); console.error(err);
    });
    // start polling status
    if(dispenserPoll) clearInterval(dispenserPoll);
    dispenserPoll = setInterval(fetchDispenserStatus,1000);
  }
}

function stopDispensing(){
  if(demoMode){ if(dispenserPoll){ clearInterval(dispenserPoll); dispenserPoll=null; dispenserState.status='PROCESSING'; updateDispenserUI(); } }
  else{ fetch(`http://${ESP32_IP}/dispense/stop`,{method:'POST'}).then(()=>{ dispenserState.status='PROCESSING'; updateDispenserUI(); }).catch(e=>{dispenserState.status='ERROR'; updateDispenserUI();}); }
}

function resetDispensing(){
  if(dispenserPoll){ clearInterval(dispenserPoll); dispenserPoll=null; }
  if(demoMode){ dispenserState = {target:dispenserState.target,released:0,remaining:dispenserState.target,progress:0,status:'READY'}; updateDispenserUI(); }
  else{ fetch(`http://${ESP32_IP}/dispense/reset`,{method:'POST'}).then(()=>{ dispenserState = {target:dispenserState.target,released:0,remaining:dispenserState.target,progress:0,status:'READY'}; updateDispenserUI(); }).catch(e=>{dispenserState.status='ERROR';updateDispenserUI();}); }
}

startDispenseBtn.addEventListener('click',()=>{
  const computed = computeMudballs();
  if(!computed) return;
  dispenserState.target = computed;
  updateDispenserUI();
  startDispensing();
});
stopDispenseBtn.addEventListener('click',()=>{ stopDispensing(); });
resetDispenseBtn.addEventListener('click',()=>{ resetDispensing(); });

// Fetching data from ESP32 or simulate
let sim = {turbidity:30,adc:2800,voltage:2.3};
function simulateStep(){
  // small random walk
  sim.adc = Math.max(0, Math.min(4095, Math.round(sim.adc + (Math.random()-0.48)*30)));
  sim.voltage = +( (sim.adc/4095*3.3).toFixed(2) );
  // turbidity random around 25-35
  sim.turbidity = +( (sim.turbidity + (Math.random()-0.5)*2).toFixed(1) );
  return {adc:sim.adc,voltage:sim.voltage,turbidity:sim.turbidity,status:determineWaterStatus(sim.turbidity)};
}

async function fetchESP32Data(){
  if(demoMode){ setESPStatus(true,'DEMO'); const d = simulateStep(); handleData(d); return; }
  if(arduinoMode) return;
  try{
    const res = await fetch(`http://${ESP32_IP}/data`,{cache:'no-store'});
    if(!res.ok) throw new Error('Bad response');
    const json = await res.json();
    setESPStatus(true);
    handleData(json);
  }catch(e){
    setESPStatus(false);
    console.warn('ESP32 fetch failed',e);
  }
}

async function fetchDispenserStatus(){
  if(demoMode){ return; }
  try{
    const res = await fetch(`http://${ESP32_IP}/dispense/status`,{cache:'no-store'});
    if(!res.ok) throw new Error('Bad');
    const j = await res.json();
    // expected fields: target,released,remaining,progress,status
    dispenserState = {...dispenserState,...j};
    updateDispenserStateFromStatus();
  }catch(e){ console.warn('dispense status fetch failed',e); }
}

function handleData(data){
  const adc = (data.adc!=null)?data.adc:NaN;
  const voltage = (data.voltage!=null)?(+(+data.voltage).toFixed(2)):(arduinoMode ? +((adc/1023*5).toFixed(2)) : ((adc)?+( (adc/4095*3.3).toFixed(2) ):'--'));
  const turbidity = (data.turbidity!=null)?(+(+data.turbidity).toFixed(1)):(null);
  const status = data.status || determineWaterStatus(turbidity);

  adcValueEl.textContent = isNaN(adc)?'--':adc;
  voltageValueEl.textContent = isNaN(voltage)?'--':voltage;
  voltageBigEl.textContent = isNaN(voltage)?'--':voltage;
  turbidityValueEl.textContent = turbidity==null?'--':turbidity;
  updateTimeEl.textContent = nowTime();
  updateStatusIndicator(status);

  // chart
  const timeLabel = nowTime();
  if(chartData.labels.length >= MAX_CHART_POINTS){ chartData.labels.shift(); chartData.datasets[0].data.shift(); }
  chartData.labels.push(timeLabel);
  chartData.datasets[0].data.push(arduinoMode ? (isNaN(adc) ? null : adc) : (turbidity==null?0:turbidity));
  if(arduinoMode){
    chartData.datasets[0].label = 'ADC Sensor (0–1023)';
    turbidityChart.options.scales.y.title.text = 'ADC';
  } else {
    chartData.datasets[0].label = 'Turbidity (NTU)';
    turbidityChart.options.scales.y.title.text = 'NTU';
  }
  turbidityChart.update();

  // history
  addHistoryEntry({time: timeLabel, adc: adc||'--', voltage: isNaN(voltage)?'--':voltage, turbidity: turbidity==null?'--':turbidity, status: status});
}

// Main loop
function startMainLoop(){
  if(fetchTimer) clearInterval(fetchTimer);
  fetchESP32Data();
  fetchTimer = setInterval(() => { fetchESP32Data(); if(!demoMode && !arduinoMode) fetchDispenserStatus(); }, UPDATE_INTERVAL);
}

// Demo toggle
demoToggle.addEventListener('click',()=>{
  demoMode = !demoMode;
  demoToggle.textContent = demoMode? 'DEMO MODE (ON)' : 'DEMO MODE';
  if(demoMode){ setESPStatus(true,'DEMO'); }
  startMainLoop();
});


// Arduino Uno connection via Web Serial API.
// Arduino sketch should print one JSON line per second, e.g. {"adc":975}
async function connectArduino(){
  if(serialPort){
    try {
      if(serialReader){ await serialReader.cancel(); serialReader.releaseLock(); serialReader = null; }
      await serialPort.close();
    } catch(e) { console.warn('Error closing serial port', e); }
    serialPort = null;
    arduinoMode = false;
    connectArduinoBtn.textContent = 'CONNECT ARDUINO UNO';
    setESPStatus(false);
    startMainLoop();
    updateDispenserUI();
    return;
  }

  if(!('serial' in navigator)){
    alert('Web Serial tidak didukung browser ini. Gunakan Chrome atau Edge desktop dan buka web melalui localhost.');
    return;
  }

  try {
    serialPort = await navigator.serial.requestPort();
    await serialPort.open({ baudRate: 9600 });
    arduinoMode = true;
    demoMode = false;
    demoToggle.textContent = 'DEMO MODE';
    connectArduinoBtn.textContent = 'DISCONNECT ARDUINO';
    setESPStatus(true);
    chartData.labels.length = 0;
    chartData.datasets[0].data.length = 0;
    chartData.datasets[0].label = 'ADC Sensor (0–1023)';
    turbidityChart.options.scales.y.title.text = 'ADC';
    turbidityChart.update();
    updateDispenserUI();
    startMainLoop();

    const decoder = new TextDecoderStream();
    const closed = serialPort.readable.pipeTo(decoder.writable).catch(() => {});
    serialReader = decoder.readable.getReader();
    serialBuffer = '';

    while (true) {
      const { value, done } = await serialReader.read();
      if (done) break;
      serialBuffer += value;
      const lines = serialBuffer.split(/\r?\n/);
      serialBuffer = lines.pop() || '';

      for (const line of lines) {
        const text = line.trim();
        if (!text) continue;
        try {
          const parsed = text.startsWith('{') ? JSON.parse(text) : { adc: Number(text) };
          const adc = Number(parsed.adc);
          if (!Number.isFinite(adc) || adc < 0 || adc > 1023) continue;
          setESPStatus(true);
          handleData({
            adc: Math.round(adc),
            voltage: +(adc * 5 / 1023).toFixed(2),
            turbidity: null,
            status: 'UNKNOWN'
          });
        } catch(e) {
          console.warn('Baris serial tidak valid:', text);
        }
      }
    }
    await closed;
  } catch(error) {
    console.error('Arduino serial error:', error);
    if(error.name !== 'NotFoundError') alert('Gagal membaca Arduino. Pastikan Serial Monitor ditutup dan baud rate 9600.');
    if(serialReader){ try { serialReader.releaseLock(); } catch(e) {} serialReader = null; }
    if(serialPort){ try { await serialPort.close(); } catch(e) {} serialPort = null; }
    arduinoMode = false;
    connectArduinoBtn.textContent = 'CONNECT ARDUINO UNO';
    setESPStatus(false);
    updateDispenserUI();
    startMainLoop();
  }
}

connectArduinoBtn.addEventListener('click', connectArduino);

// Init
(function init(){
  // load history and render
  renderHistory();
  // restore some UI
  computeMudballs();
  updateDispenserUI();
  startMainLoop();
})();
