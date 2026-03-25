import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { usePersistedState } from "./usePersistedState";
import { requestNotificationPermission, getNotificationPermission, scheduleSundayReminder } from "./notifications";
import { signInWithGoogle, logOut, onAuthChange, saveUserData, loadUserData, onUserDataChange } from "./firebase";

const DEFAULT_INCOME = 0;
const SAVINGS_TOTAL  = 15000;
const CAR_SPEND      = 7500;
const POST_CAR       = SAVINGS_TOTAL - CAR_SPEND;
const HYSA_RATE      = 0.045;
const MMK_RATE       = 0.011;

const GOALS = [
  { id:"emergency", label:"Emergency Fund", target:1500, color:"#C0392B", icon:"🛡️", monthly:375, desc:"Priority 1 — 1-2 months of future living costs. Hit this first." },
  { id:"roth",      label:"Roth IRA",       target:1200, color:"#2980B9", icon:"📈", monthly:100, desc:"Priority 2 — Open at Fidelity, buy VOO or FZROX. Start $100/mo." },
];

const CATS = [
  { id:"needs",   label:"Needs",   pct:0.5, color:"#2980B9", dot:"#3498DB", icon:"🏠" },
  { id:"wants",   label:"Wants",   pct:0.3, color:"#E67E22", dot:"#F39C12", icon:"✨" },
  { id:"savings", label:"Savings", pct:0.2, color:"#27AE60", dot:"#2ECC71", icon:"💰" },
];

const MONTHS   = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function getWeekStart(d = new Date()) {
  const s = new Date(d); s.setHours(0,0,0,0); s.setDate(s.getDate()-s.getDay()); return s;
}
function getWeekEnd(d = new Date()) {
  const e = getWeekStart(d); e.setDate(e.getDate()+6); return e;
}
function inWeek(raw)  { const d=new Date(raw); return d>=getWeekStart()&&d<=getWeekEnd(); }
function inMonth(raw) { const d=new Date(raw),n=new Date(); return d.getMonth()===n.getMonth()&&d.getFullYear()===n.getFullYear(); }
function fmt(n)       { return (+n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}); }

function DarkBg() {
  return (
    <div style={{position:"fixed",inset:0,zIndex:0,overflow:"hidden",background:"#06060B"}}>
      {/* Ambient color orbs */}
      <div style={{position:"absolute",width:"70%",height:"60%",top:"-20%",left:"-15%",background:"radial-gradient(ellipse,rgba(192,57,43,0.07) 0%,transparent 65%)",animation:"orbFloat 20s ease-in-out infinite"}}/>
      <div style={{position:"absolute",width:"60%",height:"55%",bottom:"-15%",right:"-15%",background:"radial-gradient(ellipse,rgba(41,128,185,0.05) 0%,transparent 65%)",animation:"orbFloat 25s ease-in-out infinite reverse"}}/>
      <div style={{position:"absolute",width:"45%",height:"45%",top:"35%",left:"25%",background:"radial-gradient(ellipse,rgba(39,174,96,0.035) 0%,transparent 65%)",animation:"orbFloat 18s ease-in-out 3s infinite"}}/>
      {/* Noise texture overlay */}
      <svg style={{position:"absolute",inset:0,width:"100%",height:"100%",opacity:0.03}}>
        <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="4" stitchTiles="stitch"/></filter>
        <rect width="100%" height="100%" filter="url(#grain)"/>
      </svg>
    </div>
  );
}

function Card({children, style={}, delay=0, glow=null}) {
  return (
    <div style={{background:"rgba(255,255,255,0.04)",borderRadius:20,padding:18,marginBottom:12,
      border:"1px solid rgba(255,255,255,0.06)",backdropFilter:"blur(40px)",
      boxShadow:glow?`0 0 30px ${glow}15, inset 0 1px 0 rgba(255,255,255,0.05)`:"inset 0 1px 0 rgba(255,255,255,0.05)",
      animation:`slideUp 0.45s cubic-bezier(.16,1,.3,1) ${delay}s both`,...style}}>
      {children}
    </div>
  );
}

function Bar({spent, budget, color, h=5}) {
  const pct = budget>0 ? Math.min((spent/budget)*100,100) : 0;
  const over = spent>budget&&budget>0;
  const barColor = over?"#C0392B":color;
  return (
    <div style={{width:"100%",height:h,background:"rgba(255,255,255,0.06)",borderRadius:99,overflow:"hidden",marginTop:9}}>
      <div style={{width:`${pct}%`,height:"100%",background:`linear-gradient(90deg,${barColor},${barColor}dd)`,
        borderRadius:99,transition:"width 0.6s cubic-bezier(.16,1,.3,1)",
        boxShadow:pct>0?`0 0 ${h*2}px ${barColor}40`:"none"}}/>
    </div>
  );
}

function MiniBar({data, color}) {
  const max = Math.max(...data.map(d=>d.val),1);
  return (
    <div style={{display:"flex",alignItems:"flex-end",gap:6,height:65,marginTop:12}}>
      {data.map((d,i)=>(
        <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
          <div style={{width:"100%",borderRadius:"6px 6px 2px 2px",
            background:d.active?`linear-gradient(180deg,${color},${color}88)`:color+"30",
            height:Math.max((d.val/max)*52,d.val>0?4:0),transition:"height 0.5s cubic-bezier(.16,1,.3,1)",
            boxShadow:d.active?`0 0 12px ${color}30`:"none"}}/>
          <div style={{fontSize:9,color:d.active?"rgba(255,255,255,0.6)":"rgba(255,255,255,0.2)",fontWeight:700,
            transition:"color 0.3s"}}>{d.label}</div>
        </div>
      ))}
    </div>
  );
}

function AccCard({title, available, current, dot, delay=0, onClick}) {
  return (
    <div onClick={onClick} style={{background:"rgba(255,255,255,0.04)",borderRadius:20,padding:"18px 20px",marginBottom:12,
      border:"1px solid rgba(255,255,255,0.06)",backdropFilter:"blur(40px)",
      boxShadow:`0 0 25px ${dot}10, inset 0 1px 0 rgba(255,255,255,0.05)`,
      cursor:"pointer",animation:`slideUp 0.45s cubic-bezier(.16,1,.3,1) ${delay}s both`,transition:"transform 0.15s cubic-bezier(.16,1,.3,1), box-shadow 0.3s"}}
      onTouchStart={e=>{e.currentTarget.style.transform="scale(0.975)";e.currentTarget.style.boxShadow=`0 0 35px ${dot}20, inset 0 1px 0 rgba(255,255,255,0.08)`;}}
      onTouchEnd={e=>{e.currentTarget.style.transform="scale(1)";e.currentTarget.style.boxShadow=`0 0 25px ${dot}10, inset 0 1px 0 rgba(255,255,255,0.05)`;}}>
      <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:8}}>
        <div style={{width:8,height:8,borderRadius:"50%",background:dot,boxShadow:`0 0 8px ${dot}60`}}/>
        <div style={{fontSize:12,fontWeight:700,color:"rgba(255,255,255,0.5)",letterSpacing:0.5,textTransform:"uppercase"}}>{title}</div>
      </div>
      <div style={{display:"flex",alignItems:"baseline",gap:8}}>
        <span className="hero-num" style={{fontSize:32,fontWeight:900,letterSpacing:-1}}>${fmt(available)}</span>
      </div>
      <div style={{fontSize:12,color:"rgba(255,255,255,0.25)",marginTop:4,fontWeight:600}}>Current Balance ${fmt(current)}</div>
    </div>
  );
}

function PeriodToggle({value, onChange}) {
  return (
    <div style={{display:"flex",background:"rgba(255,255,255,0.06)",borderRadius:12,padding:3,gap:2,marginBottom:16}}>
      {["week","month"].map(p=>(
        <button key={p} onClick={()=>onChange(p)} style={{flex:1,background:value===p?"rgba(255,255,255,0.1)":"transparent",
          border:value===p?"1px solid rgba(255,255,255,0.1)":"1px solid transparent",borderRadius:10,padding:"8px 0",fontSize:12,fontWeight:value===p?800:600,
          color:value===p?"#C0392B":"rgba(255,255,255,0.4)",boxShadow:"none",
          cursor:"pointer",transition:"all 0.2s",fontFamily:"inherit"}}>
          {p==="week"?"This Week":"This Month"}
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const now = new Date();

  const [tab,          setTab]         = useState("accounts");
  const [txList,       setTxList]      = usePersistedState("bp_txList", []);
  const [incList,      setIncList]     = usePersistedState("bp_incList", []);
  const [actuals,      setActuals]     = usePersistedState("bp_actuals", {needs:0,wants:0,savings:0});
  const [gProgress,    setGP]          = usePersistedState("bp_gProgress", {emergency:0,roth:0});
  const [balance,      setBalance]     = usePersistedState("bp_balance", 0);
  const [sheet,        setSheet]       = useState(null);
  const [txForm,       setTxForm]      = useState({label:"",amount:"",category:"wants"});
  const [incForm,      setIncForm]     = useState({label:"",amount:""});
  const [goalAmt,      setGoalAmt]     = useState("");
  const [activeGoal,   setAG]          = useState(null);
  const [flash,        setFlash]       = useState(null);
  const [period,       setPeriod]      = useState("week");
  const [hysaDone,     setHysaDone]    = usePersistedState("bp_hysaDone", false);
  const [rothSteps,    setRothSteps]   = usePersistedState("bp_rothSteps", {open:false,fund:false,buy:false,auto:false});
  const [lastPaycheck, setLastPaycheck]= useState(0);
  const [notifEnabled, setNotifEnabled]= usePersistedState("bp_notifEnabled", false);
  const [user, setUser]               = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const syncPause = useRef(false);
  const saveTimer = useRef(null);

  // Auth listener
  useEffect(() => {
    return onAuthChange((u) => { setUser(u); setAuthLoading(false); });
  }, []);

  // Load data from Firestore on login
  useEffect(() => {
    if (!user) return;
    let unsub;
    (async () => {
      const data = await loadUserData(user.uid);
      if (data) {
        syncPause.current = true;
        if (data.txList) setTxList(data.txList);
        if (data.incList) setIncList(data.incList);
        if (data.actuals) setActuals(data.actuals);
        if (data.gProgress) setGP(data.gProgress);
        if (data.balance !== undefined) setBalance(data.balance);
        if (data.hysaDone !== undefined) setHysaDone(data.hysaDone);
        if (data.rothSteps) setRothSteps(data.rothSteps);
        setTimeout(() => { syncPause.current = false; }, 500);
      }
      // Real-time listener for cross-device sync
      unsub = onUserDataChange(user.uid, (data) => {
        if (syncPause.current) return;
        syncPause.current = true;
        if (data.txList) setTxList(data.txList);
        if (data.incList) setIncList(data.incList);
        if (data.actuals) setActuals(data.actuals);
        if (data.gProgress) setGP(data.gProgress);
        if (data.balance !== undefined) setBalance(data.balance);
        if (data.hysaDone !== undefined) setHysaDone(data.hysaDone);
        if (data.rothSteps) setRothSteps(data.rothSteps);
        setTimeout(() => { syncPause.current = false; }, 500);
      });
    })();
    return () => unsub && unsub();
  }, [user]);

  // Debounced save to Firestore on data change
  const syncData = useCallback(() => {
    if (!user || syncPause.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveUserData(user.uid, { txList, incList, actuals, gProgress, balance, hysaDone, rothSteps });
    }, 800);
  }, [user, txList, incList, actuals, gProgress, balance, hysaDone, rothSteps]);

  useEffect(() => { syncData(); }, [syncData]);

  // Schedule Sunday reminder if notifications are enabled
  useEffect(() => {
    if (notifEnabled) scheduleSundayReminder();
  }, [notifEnabled]);

  const monthIncome  = useMemo(()=>incList.filter(t=>inMonth(t.rawDate)).reduce((s,t)=>s+t.amount,0),[incList]);
  const effIncome    = monthIncome || DEFAULT_INCOME;
  const weeklyIncome = +(effIncome/4.33).toFixed(2);
  const totalSpent   = Object.values(actuals).reduce((a,b)=>a+b,0);
  const remaining    = effIncome - totalSpent;

  const weekTx  = useMemo(()=>txList.filter(t=>inWeek(t.rawDate)),[txList]);
  const monthTx = useMemo(()=>txList.filter(t=>inMonth(t.rawDate)),[txList]);
  const periodTx    = period==="week" ? weekTx : monthTx;
  const periodTotal = periodTx.reduce((s,t)=>s+t.amount,0);
  const periodBudget= period==="week" ? weeklyIncome : effIncome;

  const periodByCat = useMemo(()=>{
    const m={needs:0,wants:0,savings:0};
    periodTx.forEach(t=>{m[t.category]=+(m[t.category]+t.amount).toFixed(2);});
    return m;
  },[periodTx]);

  const weekDailyData = useMemo(()=>{
    const ws=getWeekStart();
    return Array.from({length:7},(_,i)=>{
      const day=new Date(ws); day.setDate(ws.getDate()+i);
      const val=weekTx.filter(t=>{const d=new Date(t.rawDate);return d.getDate()===day.getDate()&&d.getMonth()===day.getMonth();}).reduce((s,t)=>s+t.amount,0);
      return {label:DAY_NAMES[day.getDay()],val,active:day.getDay()===now.getDay()};
    });
  },[weekTx]);

  const monthWeekData = useMemo(()=>{
    const weeks=[],ms=new Date(now.getFullYear(),now.getMonth(),1);
    const me=new Date(now.getFullYear(),now.getMonth()+1,0);
    let cur=new Date(ms),wi=1;
    while(cur<=me){
      const ws2=new Date(cur),we2=new Date(cur); we2.setDate(we2.getDate()+6);
      const val=monthTx.filter(t=>{const d=new Date(t.rawDate);return d>=ws2&&d<=we2;}).reduce((s,t)=>s+t.amount,0);
      weeks.push({label:`W${wi}`,val,active:now>=ws2&&now<=we2});
      cur.setDate(cur.getDate()+7); wi++;
    }
    return weeks;
  },[monthTx]);

  const topCat = useMemo(()=>CATS.reduce((a,b)=>periodByCat[b.id]>periodByCat[a.id]?b:a,CATS[0]),[periodByCat]);

  function flash2(msg){setFlash(msg);setTimeout(()=>setFlash(null),2200);}

  function addIncome(){
    const amt=parseFloat(incForm.amount);
    if(!amt||amt<=0||!incForm.label.trim()){flash2("Fill in all fields");return;}
    const rawDate=new Date();
    const inc={id:Date.now(),label:incForm.label,amount:amt,rawDate,
      date:rawDate.toLocaleDateString("en-US",{month:"short",day:"numeric"})};
    setIncList(p=>[inc,...p].slice(0,200));
    setBalance(p=>+(p+amt).toFixed(2));
    setLastPaycheck(amt);
    setIncForm({label:"",amount:""});
    setSheet("payday");
  }

  function addTx(){
    const amt=parseFloat(txForm.amount);
    if(!amt||amt<=0||!txForm.label.trim()){flash2("Fill in all fields");return;}
    const rawDate=new Date();
    const tx={id:Date.now(),...txForm,amount:amt,rawDate,
      date:rawDate.toLocaleDateString("en-US",{month:"short",day:"numeric"})};
    setTxList(p=>[tx,...p].slice(0,200));
    setActuals(p=>({...p,[tx.category]:+(p[tx.category]+amt).toFixed(2)}));
    setBalance(p=>+(p-amt).toFixed(2));
    setTxForm({label:"",amount:"",category:"wants"});
    setSheet(null);
    flash2("Expense added ✓");
  }

  function delTx(id){
    const tx=txList.find(t=>t.id===id); if(!tx) return;
    setTxList(p=>p.filter(t=>t.id!==id));
    setActuals(p=>({...p,[tx.category]:Math.max(0,+(p[tx.category]-tx.amount).toFixed(2))}));
    setBalance(p=>+(p+tx.amount).toFixed(2));
    flash2("Removed");
  }

  function delInc(id){
    const inc=incList.find(t=>t.id===id); if(!inc) return;
    setIncList(p=>p.filter(t=>t.id!==id));
    setBalance(p=>+(p-inc.amount).toFixed(2));
    flash2("Removed");
  }

  function addGoal(){
    const amt=parseFloat(goalAmt);
    if(!amt||amt<=0){flash2("Enter a valid amount");return;}
    const g=GOALS.find(g=>g.id===activeGoal);
    setGP(p=>({...p,[activeGoal]:Math.min(+(p[activeGoal]+amt).toFixed(2),g.target)}));
    setGoalAmt(""); setSheet(null);
    flash2("Goal updated ✓");
  }

  // Payday allocation calculator
  function calcAllocation(amt) {
    const emergencyLeft = Math.max(1500 - gProgress.emergency, 0);
    const emergencyAlloc = emergencyLeft > 0 ? Math.min(Math.round(amt * 0.37), emergencyLeft) : 0;
    const rothAlloc = Math.min(100, amt - emergencyAlloc);
    const hysaAlloc = Math.max(0, amt - emergencyAlloc - rothAlloc);
    return [
      emergencyAlloc > 0 && { icon:"🛡️", label:"Emergency Fund", amt:emergencyAlloc, color:"#C0392B", note:"Transfer to savings — priority #1", action:"Transfer now" },
      { icon:"📈", label:"Roth IRA", amt:rothAlloc, color:"#2980B9", note:"Log into Fidelity & buy VOO", action:"Log into Fidelity" },
      hysaAlloc > 0 && { icon:"🏦", label:"HYSA", amt:hysaAlloc, color:"#27AE60", note:"Move to SoFi / Marcus today", action:"Transfer to HYSA" },
    ].filter(Boolean);
  }

  const css=`
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
    @keyframes slideUp{from{opacity:0;transform:translateY(18px) scale(0.98)}to{opacity:1;transform:translateY(0) scale(1)}}
    @keyframes fadeIn{from{opacity:0}to{opacity:1}}
    @keyframes sheetUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
    @keyframes orbFloat{0%,100%{transform:translate(0,0) scale(1)}33%{transform:translate(12px,-18px) scale(1.05)}66%{transform:translate(-8px,12px) scale(0.95)}}
    @keyframes pulseGlow{0%,100%{opacity:0.6}50%{opacity:1}}
    @keyframes shimmer{0%{background-position:-200% center}100%{background-position:200% center}}
    *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;margin:0;padding:0}
    html,body{background:#06060B;margin:0;padding:0;overflow:hidden;position:fixed;width:100%;height:100%;overscroll-behavior:none}
    ::-webkit-scrollbar{display:none}
    input,select{-webkit-appearance:none}
    input:focus,select:focus{outline:none;border-color:rgba(192,57,43,0.5)!important;box-shadow:0 0 0 3px rgba(192,57,43,0.15), 0 0 20px rgba(192,57,43,0.1)!important}
    input::placeholder,select::placeholder{color:rgba(255,255,255,0.2)}
    select option{background:#0e0e14;color:#fff}
    .hero-num{background:linear-gradient(135deg,#ffffff 0%,rgba(255,255,255,0.75) 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
    .glow-text{text-shadow:0 0 20px currentColor}
    .brand-gradient{background:linear-gradient(135deg,#E84D3D 0%,#C0392B 50%,#A93226 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
  `;

  const S={
    root:    {position:"fixed",inset:0,fontFamily:"'Inter','SF Pro Display','Helvetica Neue',sans-serif",overflow:"hidden",color:"#fff",WebkitFontSmoothing:"antialiased"},
    screen:  {position:"absolute",inset:0,overflowY:"auto",WebkitOverflowScrolling:"touch",overscrollBehavior:"none",paddingBottom:100,zIndex:1},
    hdr:     {padding:"58px 20px 16px"},
    subhead: {fontSize:13,color:"rgba(255,255,255,0.5)",fontWeight:600,letterSpacing:0.3},
    iconBtn: {width:38,height:38,borderRadius:"50%",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",backdropFilter:"blur(20px)",transition:"background 0.2s"},
    body:    {padding:"0 14px"},
    sl:      {fontSize:10,fontWeight:700,color:"rgba(255,255,255,0.25)",textTransform:"uppercase",letterSpacing:2,marginBottom:14},
    row:     {display:"flex",alignItems:"center",gap:10},
    sb:      {display:"flex",alignItems:"center",justifyContent:"space-between"},
    divider: {height:1,background:"rgba(255,255,255,0.06)",margin:"14px 0"},
    input:   {background:"rgba(255,255,255,0.04)",border:"1.5px solid rgba(255,255,255,0.08)",borderRadius:14,color:"#fff",fontSize:15,padding:"14px 16px",width:"100%",fontFamily:"inherit",fontWeight:500,transition:"all 0.2s"},
    select:  {background:"rgba(255,255,255,0.04)",border:"1.5px solid rgba(255,255,255,0.08)",borderRadius:14,color:"#fff",fontSize:15,padding:"14px 16px",width:"100%",fontFamily:"inherit",fontWeight:500,cursor:"pointer",transition:"all 0.2s"},
    flabel:  {fontSize:10,fontWeight:700,color:"rgba(255,255,255,0.3)",textTransform:"uppercase",letterSpacing:1.2,marginBottom:8,display:"block"},
    redBtn:  {background:"linear-gradient(135deg,#E84D3D 0%,#C0392B 100%)",color:"#fff",border:"none",borderRadius:14,padding:15,fontWeight:700,fontSize:15,cursor:"pointer",width:"100%",fontFamily:"inherit",boxShadow:"0 4px 20px rgba(192,57,43,0.3)",transition:"transform 0.15s, box-shadow 0.15s"},
    greenBtn:{background:"linear-gradient(135deg,#2ECC71 0%,#27AE60 100%)",color:"#fff",border:"none",borderRadius:14,padding:15,fontWeight:700,fontSize:15,cursor:"pointer",width:"100%",fontFamily:"inherit",boxShadow:"0 4px 20px rgba(39,174,96,0.3)",transition:"transform 0.15s, box-shadow 0.15s"},
    ghostBtn:{background:"rgba(255,255,255,0.04)",color:"rgba(255,255,255,0.5)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:14,padding:15,fontWeight:600,fontSize:14,cursor:"pointer",width:"100%",fontFamily:"inherit",transition:"all 0.2s"},
    bnav:    {position:"fixed",bottom:0,left:0,right:0,background:"#06060B",borderTop:"1px solid rgba(255,255,255,0.06)",display:"flex",justifyContent:"space-around",paddingTop:10,paddingBottom:10,zIndex:50},
    nb:      (a)=>({background:"none",border:"none",display:"flex",flexDirection:"column",alignItems:"center",gap:4,color:a?"#E84D3D":"rgba(255,255,255,0.28)",fontSize:10,fontWeight:a?700:500,cursor:"pointer",padding:"0 8px",fontFamily:"inherit",transition:"color 0.2s",position:"relative"}),
    overlay: {position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:100,display:"flex",alignItems:"flex-end",animation:"fadeIn 0.2s ease",backdropFilter:"blur(4px)"},
    sheet:   {background:"#0e0e14",borderRadius:"24px 24px 0 0",width:"100%",animation:"sheetUp 0.32s cubic-bezier(.16,1,.3,1)",maxHeight:"92vh",overflowY:"auto",paddingBottom:"env(safe-area-inset-bottom,20px)",border:"1px solid rgba(255,255,255,0.06)",borderBottom:"none",boxShadow:"0 -10px 40px rgba(0,0,0,0.3)"},
    handle:  {width:36,height:4,background:"rgba(255,255,255,0.15)",borderRadius:99,margin:"14px auto 20px"},
    stitle:  {fontSize:20,fontWeight:800,color:"#fff",padding:"0 20px 18px",letterSpacing:-0.3},
    sbody:   {padding:"0 20px"},
    fg:      {marginBottom:18},
    flash:   {position:"fixed",top:58,left:"50%",transform:"translateX(-50%)",background:"rgba(255,255,255,0.08)",color:"#fff",padding:"10px 24px",borderRadius:99,fontWeight:600,fontSize:13,zIndex:999,whiteSpace:"nowrap",backdropFilter:"blur(30px)",border:"1px solid rgba(255,255,255,0.08)",animation:"fadeIn 0.2s ease",boxShadow:"0 8px 32px rgba(0,0,0,0.3)"},
    fab:     {position:"fixed",bottom:"calc(env(safe-area-inset-bottom, 14px) + 74px)",right:18,width:56,height:56,borderRadius:"50%",background:"linear-gradient(135deg,#E84D3D 0%,#C0392B 100%)",border:"none",color:"#fff",fontSize:26,cursor:"pointer",boxShadow:"0 4px 24px rgba(192,57,43,0.4), 0 0 40px rgba(192,57,43,0.15)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:49,transition:"transform 0.15s cubic-bezier(.16,1,.3,1), box-shadow 0.15s"},
    tip:     {background:"rgba(192,57,43,0.06)",border:"1px solid rgba(192,57,43,0.12)",borderRadius:16,padding:"14px 16px",marginBottom:12},
  };

  const navItems=[
    {id:"accounts",icon:"🏦",label:"Accounts"},
    {id:"budget",  icon:"📊",label:"Budget"},
    {id:"stats",   icon:"📈",label:"Stats"},
    {id:"goals",   icon:"🎯",label:"Goals"},
    {id:"activity",icon:"📋",label:"Activity"},
  ];

  const weekLabel  = getWeekStart().toLocaleDateString("en-US",{month:"short",day:"numeric"}) + " – " + getWeekEnd().toLocaleDateString("en-US",{month:"short",day:"numeric"});
  const monthLabel = MONTHS[now.getMonth()] + " " + now.getFullYear();

  return (
    <div style={S.root}>
      <style>{css}</style>
      <DarkBg/>
      {flash && <div style={S.flash}>{flash}</div>}

      {/* ══ ACCOUNTS ══ */}
      {tab==="accounts" && (
        <div style={S.screen}>
          <div style={S.hdr}>
            <div style={S.sb}>
              <div>
                <div className="brand-gradient" style={{fontSize:22,fontWeight:900,letterSpacing:-0.5,marginBottom:4}}>en$ure</div>
                <div style={S.subhead}>Your accounts</div>
              </div>
              <div style={S.row}>
                <button style={S.iconBtn}><span style={{fontSize:16}}>🔔</span></button>
                {user ? (
                  <button style={{...S.iconBtn,overflow:"hidden",padding:0}} onClick={()=>setSheet("profile")}>
                    {user.photoURL ? <img src={user.photoURL} alt="" style={{width:"100%",height:"100%",borderRadius:"50%"}}/> : <span style={{fontSize:16}}>👤</span>}
                  </button>
                ) : (
                  <button style={S.iconBtn} onClick={async()=>{try{await signInWithGoogle();flash2("Signed in ✓");}catch(e){if(e.code!=="auth/popup-closed-by-user")flash2("Sign in failed");}}}>
                    <span style={{fontSize:16}}>👤</span>
                  </button>
                )}
              </div>
            </div>
          </div>
          <div style={S.body}>
            <AccCard title="Brett's Checking" available={balance} current={balance} dot="#8B6914" delay={0} onClick={()=>setSheet("checking")}/>
            <AccCard title="Emergency Fund"   available={gProgress.emergency} current={gProgress.emergency} dot="#C0392B" delay={0.12} onClick={()=>{setAG("emergency");setSheet("goal");}}/>
            <AccCard title="Roth IRA"         available={gProgress.roth} current={gProgress.roth} dot="#2980B9" delay={0.18} onClick={()=>{setAG("roth");setSheet("goal");}}/>
          </div>
        </div>
      )}

      {/* ══ BUDGET ══ */}
      {tab==="budget" && (
        <div style={S.screen}>
          <div style={S.hdr}><div style={S.subhead}>{monthLabel} Budget</div></div>
          <div style={S.body}>
            <Card delay={0}>
              <div style={S.sl}>Monthly Overview</div>
              <div className="hero-num" style={{fontSize:36,fontWeight:900,letterSpacing:-1.5}}>${fmt(effIncome)}</div>
              <div style={{fontSize:13,color:"rgba(255,255,255,0.45)",marginTop:3}}>
                ${fmt(totalSpent)} spent ·{" "}
                <span style={{color:remaining>=0?"#27AE60":"#C0392B",fontWeight:700}}>
                  ${fmt(Math.abs(remaining))} {remaining>=0?"remaining":"over"}
                </span>
              </div>
              <Bar spent={totalSpent} budget={effIncome} color="#C0392B"/>
              <div style={{...S.sb,marginTop:7}}>
                <span style={{fontSize:11,color:"rgba(255,255,255,0.3)",fontWeight:700}}>{effIncome>0?((totalSpent/effIncome)*100).toFixed(0):0}% allocated</span>
                <span style={{fontSize:11,color:"#27AE60",fontWeight:800}}>{effIncome>0?((actuals.savings/effIncome)*100).toFixed(1):0}% savings rate</span>
              </div>
            </Card>
            {CATS.map((cat,i)=>{
              const spent=actuals[cat.id];
              const bgt=+(effIncome*cat.pct).toFixed(2);
              const over=spent>bgt;
              return (
                <Card key={cat.id} delay={0.06*(i+1)} style={{borderLeft:`4px solid ${cat.dot}`}}>
                  <div style={S.sb}>
                    <div style={S.row}>
                      <span style={{fontSize:20}}>{cat.icon}</span>
                      <div>
                        <div style={{fontSize:15,fontWeight:800,color:"#fff"}}>{cat.label}</div>
                        <div style={{fontSize:11,color:"rgba(255,255,255,0.3)",fontWeight:600}}>{Math.round(cat.pct*100)}% · budget ${fmt(bgt)}</div>
                      </div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:19,fontWeight:900,color:over?"#C0392B":cat.color}}>${fmt(spent)}</div>
                      <div style={{fontSize:11,color:over?"#C0392B":"rgba(255,255,255,0.3)",fontWeight:600}}>{over?"$"+fmt(spent-bgt)+" over":"$"+fmt(bgt-spent)+" left"}</div>
                    </div>
                  </div>
                  <Bar spent={spent} budget={bgt} color={cat.dot}/>
                </Card>
              );
            })}
            <div style={S.tip}>
              <div style={{fontSize:12,color:"#C0392B",lineHeight:1.75,fontWeight:700}}>
                💡 Since your parents cover needs, push 60–80% into savings. Tap + to track personal expenses.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ STATS ══ */}
      {tab==="stats" && (
        <div style={S.screen}>
          <div style={S.hdr}><div style={S.subhead}>Spending Stats</div></div>
          <div style={S.body}>
            <PeriodToggle value={period} onChange={setPeriod}/>
            <Card delay={0}>
              <div style={S.sb}>
                <div>
                  <div style={S.sl}>{period==="week"?weekLabel:monthLabel}</div>
                  <div className="hero-num" style={{fontSize:34,fontWeight:900,letterSpacing:-1.5}}>${fmt(periodTotal)}</div>
                  <div style={{fontSize:13,color:"rgba(255,255,255,0.45)",marginTop:3}}>of ${fmt(periodBudget)} {period==="week"?"weekly":"monthly"} budget</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:11,color:"rgba(255,255,255,0.3)",fontWeight:700,marginBottom:4}}>Budget used</div>
                  <div style={{fontSize:26,fontWeight:900,color:periodTotal>periodBudget?"#C0392B":"#27AE60"}}>
                    {periodBudget>0?Math.min(((periodTotal/periodBudget)*100),100).toFixed(0):0}%
                  </div>
                  <div style={{background:(periodTotal>periodBudget?"#C0392B":"#27AE60")+"18",color:periodTotal>periodBudget?"#C0392B":"#27AE60",borderRadius:99,padding:"4px 10px",fontSize:11,fontWeight:800}}>
                    {periodTotal>periodBudget?"Over":"Under"} budget
                  </div>
                </div>
              </div>
              <Bar spent={periodTotal} budget={periodBudget} color="#C0392B" h={7}/>
            </Card>
            <Card delay={0.06}>
              <div style={S.sl}>{period==="week"?"Daily Spending":"Weekly Spending"}</div>
              <MiniBar data={period==="week"?weekDailyData:monthWeekData} color="#C0392B"/>
              {periodTx.length===0 && <div style={{textAlign:"center",color:"rgba(255,255,255,0.25)",fontSize:12,fontWeight:600,marginTop:8}}>No transactions logged yet</div>}
            </Card>
            <Card delay={0.12}>
              <div style={S.sl}>By Category</div>
              {CATS.map((cat,i)=>{
                const spent=periodByCat[cat.id];
                const bgt=+(effIncome*cat.pct/(period==="week"?4.33:1)).toFixed(2);
                const pct=bgt>0?Math.min((spent/bgt)*100,100):0;
                return (
                  <div key={cat.id} style={{marginBottom:i<2?16:0}}>
                    <div style={S.sb}>
                      <div style={S.row}>
                        <div style={{width:34,height:34,borderRadius:11,background:cat.dot+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17}}>{cat.icon}</div>
                        <div>
                          <div style={{fontSize:14,fontWeight:700,color:"#fff"}}>{cat.label}</div>
                          <div style={{fontSize:10,color:"rgba(255,255,255,0.3)",fontWeight:600}}>budget ${fmt(bgt)}</div>
                        </div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontSize:16,fontWeight:800,color:spent>bgt?"#C0392B":cat.color}}>${fmt(spent)}</div>
                        <div style={{fontSize:10,color:"rgba(255,255,255,0.3)",fontWeight:600}}>{pct.toFixed(0)}% used</div>
                      </div>
                    </div>
                    <Bar spent={spent} budget={bgt} color={cat.dot} h={5}/>
                    {i<2 && <div style={S.divider}/>}
                  </div>
                );
              })}
            </Card>
            <Card delay={0.18}>
              <div style={S.sl}>Insights</div>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <div style={{background:"rgba(255,255,255,0.05)",borderRadius:12,padding:"12px 14px"}}>
                  <div style={{fontSize:12,fontWeight:800,color:"#fff",marginBottom:3}}>{period==="week"?"🗓️ Weekly pace":"📅 Monthly pace"}</div>
                  <div style={{fontSize:12,color:"rgba(255,255,255,0.4)"}}>
                    {periodTotal===0?"No spending logged yet."
                      :period==="week"?"Spending ~$"+fmt(periodTotal/7)+"/day. At this pace, ~$"+fmt(periodTotal/7*30)+"/month."
                      :"Spent $"+fmt(periodTotal)+" of $"+fmt(effIncome)+" ("+( effIncome>0?((periodTotal/effIncome)*100).toFixed(0):0)+"%) this month."}
                  </div>
                </div>
                {periodTotal>0 && (
                  <div style={{background:"rgba(255,255,255,0.05)",borderRadius:12,padding:"12px 14px"}}>
                    <div style={{fontSize:12,fontWeight:800,color:"#fff",marginBottom:3}}>🏆 Top category</div>
                    <div style={{fontSize:12,color:"rgba(255,255,255,0.4)"}}>
                      <span style={{color:topCat.color,fontWeight:800}}>{topCat.icon} {topCat.label}</span>{" "}is your biggest spend at ${fmt(periodByCat[topCat.id])} this {period}.
                    </div>
                  </div>
                )}
                <div style={{background:"rgba(255,255,255,0.05)",borderRadius:12,padding:"12px 14px"}}>
                  <div style={{fontSize:12,fontWeight:800,color:"#fff",marginBottom:3}}>💰 Savings check</div>
                  <div style={{fontSize:12,color:"rgba(255,255,255,0.4)"}}>
                    {actuals.savings===0?"No savings logged yet. Even $50 this week makes a difference!"
                      :"Saved $"+fmt(actuals.savings)+" — "+(effIncome>0?((actuals.savings/effIncome)*100).toFixed(1):0)+"% of income. "+(actuals.savings>=(effIncome*0.2)?"✅ On track!":"Goal is $"+fmt(effIncome*0.2)+".")}
                  </div>
                </div>
              </div>
            </Card>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
              {[
                {label:period==="week"?"Transactions\nthis week":"Transactions\nthis month",val:periodTx.length,color:"#2980B9"},
                {label:"Avg per\ntransaction",val:periodTx.length>0?"$"+fmt(periodTotal/periodTx.length):"—",color:"#E67E22"},
              ].map((s,i)=>(
                <Card key={i} delay={0.22+i*0.04} style={{marginBottom:0,textAlign:"center",padding:"16px 14px"}}>
                  <div style={{fontSize:26,fontWeight:900,color:s.color,letterSpacing:-0.5}}>{s.val}</div>
                  <div style={{fontSize:10,color:"rgba(255,255,255,0.3)",fontWeight:700,marginTop:4,whiteSpace:"pre-line",lineHeight:1.4}}>{s.label}</div>
                </Card>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══ GOALS ══ */}
      {tab==="goals" && (
        <div style={S.screen}>
          <div style={S.hdr}><div style={S.subhead}>Your Independence Plan</div></div>
          <div style={S.body}>

            {/* Sunday money date */}
            <Card delay={0} style={{background:"linear-gradient(135deg,#1a1a2e 0%,#16213e 100%)",border:"none"}}>
              <div style={{...S.sb,marginBottom:14}}>
                <div>
                  <div style={{fontSize:11,fontWeight:800,color:"rgba(255,255,255,0.4)",textTransform:"uppercase",letterSpacing:1.8,marginBottom:4}}>Sunday Money Date</div>
                  <div style={{fontSize:18,fontWeight:900,color:"#fff"}}>10 min. Every week.</div>
                </div>
                <span style={{fontSize:32}}>📅</span>
              </div>
              {[
                {step:"1",action:"Log any expenses from the week",icon:"📋"},
                {step:"2",action:"Log any income received",icon:"💵"},
                {step:"3",action:"Check your goal progress below",icon:"🎯"},
                {step:"4",action:"Move leftover to HYSA if possible",icon:"🏦"},
              ].map((s,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"8px 0",
                  borderBottom:i<3?"1px solid rgba(255,255,255,0.07)":"none"}}>
                  <div style={{width:24,height:24,borderRadius:"50%",background:"rgba(192,57,43,0.4)",
                    display:"flex",alignItems:"center",justifyContent:"center",
                    fontSize:11,fontWeight:900,color:"#C0392B",flexShrink:0}}>{s.step}</div>
                  <div style={{fontSize:13,color:"rgba(255,255,255,0.8)",fontWeight:600,flex:1}}>{s.action}</div>
                  <span style={{fontSize:16}}>{s.icon}</span>
                </div>
              ))}
              <button onClick={async()=>{
                if(notifEnabled){setNotifEnabled(false);flash2("Reminders off");return;}
                const perm=await requestNotificationPermission();
                if(perm==="granted"){setNotifEnabled(true);scheduleSundayReminder();flash2("Sunday reminders on! 🔔");}
                else flash2("Notifications blocked — check browser settings");
              }} style={{background:notifEnabled?"rgba(39,174,96,0.1)":"rgba(255,255,255,0.12)",
                border:"1.5px solid "+(notifEnabled?"rgba(39,174,96,0.3)":"rgba(255,255,255,0.2)"),
                borderRadius:10,padding:"9px 14px",fontWeight:700,fontSize:12,
                color:notifEnabled?"#27AE60":"rgba(255,255,255,0.7)",cursor:"pointer",width:"100%",
                fontFamily:"inherit",marginTop:14}}>
                {notifEnabled?"✅ Sunday reminders on — tap to turn off":"🔔 Turn on Sunday reminders"}
              </button>
            </Card>

            {/* Paycheck allocation */}
            <Card delay={0.07} style={{borderLeft:"4px solid #C0392B"}}>
              <div style={S.sl}>Every Paycheck — Allocate This</div>
              <div style={{background:"rgba(41,128,185,0.07)",border:"1px solid rgba(41,128,185,0.15)",borderRadius:11,padding:"9px 13px",marginBottom:14}}>
                <div style={{fontSize:11,color:"#2980B9",fontWeight:700}}>💡 You're paid biweekly and hours vary — log each check and the payday screen instantly calculates your exact split.</div>
              </div>
              {[
                {label:"Emergency Fund",pct:"37%",color:"#C0392B",icon:"🛡️",note:"until $1,500 reached — priority #1",example:"37¢ of every dollar, auto-calculated"},
                {label:"Roth IRA",      pct:"flat $100",color:"#2980B9",icon:"📈",note:"fixed amount every paycheck",example:"$100 no matter the check size"},
                {label:"HYSA",          pct:"rest",color:"#27AE60",icon:"🏦",note:"everything left — let it compound",example:"whatever's left after the above two"},
              ].map((item,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                  padding:"12px 0",borderBottom:i<2?"1px solid rgba(255,255,255,0.06)":"none"}}>
                  <div style={S.row}>
                    <div style={{width:38,height:38,borderRadius:11,background:item.color+"18",
                      display:"flex",alignItems:"center",justifyContent:"center",fontSize:19,flexShrink:0}}>{item.icon}</div>
                    <div>
                      <div style={{fontSize:13,fontWeight:800,color:"#fff"}}>{item.label}</div>
                      <div style={{fontSize:10,color:"rgba(255,255,255,0.3)",fontWeight:600}}>{item.note}</div>
                      <div style={{fontSize:9,color:"rgba(255,255,255,0.2)",fontWeight:600,marginTop:1}}>{item.example}</div>
                    </div>
                  </div>
                  <div style={{background:item.color+"18",color:item.color,borderRadius:99,
                    padding:"6px 14px",fontSize:14,fontWeight:900,flexShrink:0}}>{item.pct}</div>
                </div>
              ))}
            </Card>

            {/* Emergency Fund goal */}
            {(()=>{
              const goal=GOALS[0];
              const prog=gProgress[goal.id];
              const pct=Math.min((prog/goal.target)*100,100);
              const done=prog>=goal.target;
              const left=Math.max(goal.target-prog,0);
              const mo=done?0:Math.ceil(left/375);
              return (
                <Card delay={0.14} style={{borderLeft:"4px solid "+goal.color,cursor:"pointer"}} onClick={()=>{setAG(goal.id);setSheet("goal");}}>
                  <div style={S.sb}>
                    <div style={S.row}>
                      <div style={{width:42,height:42,borderRadius:13,background:goal.color+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>
                        {done?"✅":goal.icon}
                      </div>
                      <div>
                        <div style={{fontSize:15,fontWeight:800,color:"#fff"}}>{goal.label}</div>
                        <div style={{fontSize:11,color:"rgba(255,255,255,0.3)",fontWeight:600}}>
                          {done?"Complete! 🎉":"$"+left.toFixed(0)+" left · ~"+mo+" month"+(mo!==1?"s":"")}
                        </div>
                      </div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:19,fontWeight:900,color:done?"#27AE60":goal.color}}>{pct.toFixed(0)}%</div>
                      <div style={{fontSize:11,color:"rgba(255,255,255,0.3)",fontWeight:600}}>${fmt(prog)} / $1,500</div>
                    </div>
                  </div>
                  <div style={{height:7,background:"rgba(255,255,255,0.1)",borderRadius:99,overflow:"hidden",marginTop:12}}>
                    <div style={{width:pct+"%",height:"100%",background:done?"#27AE60":goal.color,borderRadius:99,transition:"width 0.6s ease"}}/>
                  </div>
                  <div style={{fontSize:11,color:"rgba(255,255,255,0.4)",marginTop:8,lineHeight:1.6}}>{goal.desc}</div>
                </Card>
              );
            })()}

            {/* Roth IRA goal with checklist */}
            {(()=>{
              const goal=GOALS[1];
              const prog=gProgress[goal.id];
              const pct=Math.min((prog/goal.target)*100,100);
              const steps=[
                {id:"open",label:"Open Roth IRA at Fidelity.com",sub:"Free, takes 10 min"},
                {id:"fund",label:"Make first deposit ($100+)",sub:"Any amount gets it started"},
                {id:"buy", label:"Buy VOO or FZROX",sub:"Index funds — set and forget"},
                {id:"auto",label:"Set $100/mo auto-deposit",sub:"Automate so you never forget"},
              ];
              const stepsComplete=Object.values(rothSteps).filter(Boolean).length;
              return (
                <Card delay={0.21} style={{borderLeft:"4px solid "+goal.color}}>
                  <div style={{...S.sb,marginBottom:12,cursor:"pointer"}} onClick={()=>{setAG(goal.id);setSheet("goal");}}>
                    <div style={S.row}>
                      <div style={{width:42,height:42,borderRadius:13,background:goal.color+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>
                        {stepsComplete===4?"✅":goal.icon}
                      </div>
                      <div>
                        <div style={{fontSize:15,fontWeight:800,color:"#fff"}}>{goal.label}</div>
                        <div style={{fontSize:11,color:"rgba(255,255,255,0.3)",fontWeight:600}}>{stepsComplete}/4 steps done · ${fmt(prog)} saved</div>
                      </div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:19,fontWeight:900,color:goal.color}}>{pct.toFixed(0)}%</div>
                      <div style={{fontSize:11,color:"rgba(255,255,255,0.3)",fontWeight:600}}>of $1,200 yr 1</div>
                    </div>
                  </div>
                  <div style={{height:7,background:"rgba(255,255,255,0.1)",borderRadius:99,overflow:"hidden",marginBottom:14}}>
                    <div style={{width:pct+"%",height:"100%",background:goal.color,borderRadius:99,transition:"width 0.6s ease"}}/>
                  </div>
                  {steps.map((step,i)=>(
                    <div key={step.id} onClick={()=>setRothSteps(p=>({...p,[step.id]:!p[step.id]}))}
                      style={{display:"flex",alignItems:"center",gap:12,padding:"9px 0",
                        borderBottom:i<3?"1px solid rgba(255,255,255,0.06)":"none",cursor:"pointer"}}>
                      <div style={{width:24,height:24,borderRadius:"50%",flexShrink:0,
                        background:rothSteps[step.id]?"#2980B9":"transparent",
                        border:"2px solid "+(rothSteps[step.id]?"#2980B9":"rgba(255,255,255,0.15)"),
                        display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.2s"}}>
                        {rothSteps[step.id] && <span style={{color:"#fff",fontSize:13,fontWeight:900}}>✓</span>}
                      </div>
                      <div>
                        <div style={{fontSize:13,fontWeight:700,color:rothSteps[step.id]?"rgba(255,255,255,0.25)":"rgba(255,255,255,0.85)",
                          textDecoration:rothSteps[step.id]?"line-through":"none",transition:"color 0.2s"}}>{step.label}</div>
                        <div style={{fontSize:10,color:"rgba(255,255,255,0.25)",fontWeight:600}}>{step.sub}</div>
                      </div>
                    </div>
                  ))}
                </Card>
              );
            })()}

            {/* HYSA action card */}
            <Card delay={0.28} style={{borderLeft:"4px solid #F39C12"}}>
              <div style={S.sb}>
                <div style={S.row}>
                  <div style={{width:42,height:42,borderRadius:13,background:"#F39C1218",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>
                    {hysaDone?"✅":"🏦"}
                  </div>
                  <div>
                    <div style={{fontSize:15,fontWeight:800,color:"#fff"}}>Move $15k to a HYSA</div>
                    <div style={{fontSize:11,color:hysaDone?"#27AE60":"rgba(255,255,255,0.3)",fontWeight:600}}>
                      {hysaDone?"Done — earning $675/yr 🎉":"Earning $510/yr less than you could be"}
                    </div>
                  </div>
                </div>
                <div style={{fontSize:19,fontWeight:900,color:hysaDone?"#27AE60":"#F39C12"}}>{hysaDone?"✅":"!"}</div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,margin:"12px 0"}}>
                {[
                  {label:"Money Market (1.1%)",val:"$165/yr",color:"rgba(255,255,255,0.3)"},
                  {label:"HYSA (4.5%)",val:"$675/yr",color:"#27AE60"},
                ].map((s,i)=>(
                  <div key={i} style={{background:"rgba(255,255,255,0.05)",borderRadius:12,padding:"10px",textAlign:"center"}}>
                    <div style={{fontSize:16,fontWeight:900,color:s.color}}>{s.val}</div>
                    <div style={{fontSize:9,color:"rgba(255,255,255,0.3)",fontWeight:700,marginTop:2}}>{s.label}</div>
                  </div>
                ))}
              </div>
              <div style={{fontSize:11,color:"rgba(255,255,255,0.4)",marginBottom:12,lineHeight:1.6}}>
                Try <strong>SoFi</strong>, <strong>Marcus</strong>, or <strong>Ally</strong> — free, FDIC insured, transfer anytime.
              </div>
              <button onClick={()=>setHysaDone(p=>!p)} style={{
                background:hysaDone?"rgba(255,255,255,0.06)":"rgba(243,156,18,0.1)",
                color:hysaDone?"rgba(255,255,255,0.4)":"#E67E22",
                border:"1.5px solid "+(hysaDone?"rgba(255,255,255,0.1)":"#F39C1244"),
                borderRadius:10,padding:"9px 14px",fontWeight:700,fontSize:12,
                cursor:"pointer",width:"100%",fontFamily:"inherit"}}>
                {hysaDone?"↩ Mark as incomplete":"✅ Mark HYSA as opened & funded"}
              </button>
            </Card>

            {/* Income growth */}
            <Card delay={0.35}>
              <div style={S.sl}>Income Growth Tracker</div>
              <div style={S.sb}>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:"#fff"}}>This Month</div>
                  <div style={{fontSize:26,fontWeight:900,color:"#27AE60",letterSpacing:-0.5}}>${fmt(monthIncome||DEFAULT_INCOME)}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:13,fontWeight:700,color:"#fff"}}>Paychecks</div>
                  <div style={{fontSize:26,fontWeight:900,color:"#2980B9",letterSpacing:-0.5}}>{incList.length}</div>
                </div>
              </div>
              <div style={{background:"rgba(255,255,255,0.05)",borderRadius:12,padding:"10px 14px",marginTop:12}}>
                <div style={{fontSize:11,color:"rgba(255,255,255,0.4)",fontWeight:600,lineHeight:1.6}}>
                  💼 Every $100/mo raise or side hustle deposit cuts your goals timeline. Log every paycheck to track growth.
                </div>
              </div>
            </Card>

          </div>
        </div>
      )}

      {/* ══ ACTIVITY ══ */}
      {tab==="activity" && (
        <div style={S.screen}>
          <div style={S.hdr}><div style={S.subhead}>Recent Activity</div></div>
          <div style={S.body}>
            {incList.length>0 && (
              <Card delay={0}>
                <div style={S.sl}>Income</div>
                {incList.map((inc,i)=>(
                  <div key={inc.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 0",borderBottom:i<incList.length-1?"1px solid rgba(255,255,255,0.06)":"none"}}>
                    <div style={S.row}>
                      <div style={{width:40,height:40,borderRadius:13,background:"#27AE6018",display:"flex",alignItems:"center",justifyContent:"center",fontSize:19,flexShrink:0}}>💵</div>
                      <div>
                        <div style={{fontSize:14,fontWeight:700,color:"#fff"}}>{inc.label}</div>
                        <div style={{fontSize:11,color:"rgba(255,255,255,0.3)",fontWeight:600}}>{inc.date}</div>
                      </div>
                    </div>
                    <div style={S.row}>
                      <div style={{fontSize:15,fontWeight:800,color:"#27AE60"}}>+${fmt(inc.amount)}</div>
                      <button onClick={()=>delInc(inc.id)} style={{background:"none",border:"none",color:"rgba(255,255,255,0.2)",cursor:"pointer",fontSize:20,padding:"0 0 0 8px",lineHeight:1}}>×</button>
                    </div>
                  </div>
                ))}
              </Card>
            )}
            <Card delay={incList.length>0?0.06:0}>
              <div style={S.sl}>Expenses</div>
              {txList.length===0?(
                <div style={{textAlign:"center",padding:"30px 0",color:"rgba(255,255,255,0.25)"}}>
                  <div style={{fontSize:34,marginBottom:10}}>💳</div>
                  <div style={{fontSize:15,fontWeight:700,color:"rgba(255,255,255,0.3)"}}>No expenses yet</div>
                  <div style={{fontSize:12,marginTop:4}}>Tap + to log an expense</div>
                </div>
              ):txList.map((tx,i)=>{
                const cat=CATS.find(c=>c.id===tx.category);
                return (
                  <div key={tx.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 0",borderBottom:i<txList.length-1?"1px solid rgba(255,255,255,0.06)":"none"}}>
                    <div style={S.row}>
                      <div style={{width:40,height:40,borderRadius:13,background:(cat?.dot||"#888")+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:19,flexShrink:0}}>{cat?.icon}</div>
                      <div>
                        <div style={{fontSize:14,fontWeight:700,color:"#fff"}}>{tx.label}</div>
                        <div style={{fontSize:11,color:"rgba(255,255,255,0.3)",fontWeight:600}}>{tx.date} · <span style={{color:cat?.dot}}>{cat?.label}</span></div>
                      </div>
                    </div>
                    <div style={S.row}>
                      <div style={{fontSize:15,fontWeight:800,color:"#C0392B"}}>-${fmt(tx.amount)}</div>
                      <button onClick={()=>delTx(tx.id)} style={{background:"none",border:"none",color:"rgba(255,255,255,0.2)",cursor:"pointer",fontSize:20,padding:"0 0 0 8px",lineHeight:1}}>×</button>
                    </div>
                  </div>
                );
              })}
            </Card>
          </div>
        </div>
      )}

      {/* FAB */}
      <button style={S.fab} onClick={()=>setSheet("fabMenu")}>＋</button>

      {/* Bottom nav */}
      <nav style={S.bnav}>
        {navItems.map(n=>{
          const active=tab===n.id;
          return (
            <button key={n.id} style={S.nb(active)} onClick={()=>setTab(n.id)}>
              <span style={{fontSize:20,transition:"transform 0.2s",transform:active?"scale(1.1)":"scale(1)"}}>{n.icon}</span>
              <span>{n.label}</span>
              {active && <div style={{position:"absolute",top:-1,width:20,height:2,borderRadius:99,
                background:"#E84D3D",boxShadow:"0 0 8px rgba(232,77,61,0.5)"}}/>}
            </button>
          );
        })}
      </nav>

      {/* ── FAB MENU ── */}
      {sheet==="fabMenu" && (
        <div style={S.overlay} onClick={()=>setSheet(null)}>
          <div style={S.sheet} onClick={e=>e.stopPropagation()}>
            <div style={S.handle}/>
            <div style={{padding:"0 20px 20px"}}>
              <div style={{fontSize:16,fontWeight:800,color:"#fff",marginBottom:16}}>What would you like to add?</div>
              <button style={{...S.greenBtn,marginBottom:10,display:"flex",alignItems:"center",justifyContent:"center",gap:10}}
                onClick={()=>setSheet("addIncome")}>
                <span style={{fontSize:20}}>💵</span> Add Income
              </button>
              <button style={{...S.ghostBtn,display:"flex",alignItems:"center",justifyContent:"center",gap:10}}
                onClick={()=>setSheet("addTx")}>
                <span style={{fontSize:20}}>💳</span> Add Expense
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ADD INCOME ── */}
      {sheet==="addIncome" && (
        <div style={S.overlay} onClick={()=>setSheet(null)}>
          <div style={S.sheet} onClick={e=>e.stopPropagation()}>
            <div style={S.handle}/>
            <div style={S.stitle}>💵 Add Income</div>
            <div style={S.sbody}>
              <div style={{background:"rgba(39,174,96,0.07)",border:"1px solid rgba(39,174,96,0.2)",borderRadius:12,padding:"12px 14px",marginBottom:18}}>
                <div style={{fontSize:12,color:"#27AE60",fontWeight:700,lineHeight:1.6}}>After logging, we'll show you exactly where to put this money.</div>
              </div>
              <div style={S.fg}>
                <label style={S.flabel}>Source</label>
                <input style={S.input} placeholder="e.g. Paycheck, Side hustle, Gift…" value={incForm.label} onChange={e=>setIncForm(p=>({...p,label:e.target.value}))}/>
              </div>
              <div style={S.fg}>
                <label style={S.flabel}>Amount</label>
                <input style={S.input} type="number" inputMode="decimal" placeholder="$0.00" value={incForm.amount} onChange={e=>setIncForm(p=>({...p,amount:e.target.value}))}/>
              </div>
              <div style={{display:"flex",gap:10,marginTop:8,paddingBottom:8}}>
                <button style={{...S.ghostBtn,flex:1}} onClick={()=>setSheet(null)}>Cancel</button>
                <button style={{...S.greenBtn,flex:2}} onClick={addIncome}>Add Income</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── PAYDAY SHEET ── */}
      {sheet==="payday" && lastPaycheck>0 && (()=>{
        const amt = lastPaycheck;
        const allocations = calcAllocation(amt);
        const totalAllocated = allocations.reduce((s,a)=>s+a.amt,0);
        const emergencyLeft = Math.max(1500 - gProgress.emergency, 0);
        return (
          <div style={S.overlay} onClick={()=>setSheet(null)}>
            <div style={S.sheet} onClick={e=>e.stopPropagation()}>
              <div style={S.handle}/>
              <div style={{padding:"0 20px 24px"}}>
                <div style={{textAlign:"center",marginBottom:22}}>
                  <div style={{fontSize:40,marginBottom:8}}>💵</div>
                  <div style={{fontSize:22,fontWeight:900,color:"#fff",letterSpacing:-0.5}}>Paycheck Logged!</div>
                  <div style={{fontSize:32,fontWeight:900,color:"#27AE60",letterSpacing:-1,marginTop:4}}>${fmt(amt)}</div>
                  <div style={{fontSize:12,color:"rgba(255,255,255,0.3)",fontWeight:600,marginTop:6}}>Here's exactly where it goes 👇</div>
                </div>

                {allocations.map((item,i)=>(
                  <div key={i} style={{background:item.color+"08",border:"1.5px solid "+item.color+"25",
                    borderRadius:16,padding:"14px 16px",marginBottom:10}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <div style={{width:40,height:40,borderRadius:12,background:item.color+"18",
                          display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>{item.icon}</div>
                        <div>
                          <div style={{fontSize:14,fontWeight:800,color:"#fff"}}>{item.label}</div>
                          <div style={{fontSize:11,color:"rgba(255,255,255,0.35)",fontWeight:600}}>{item.note}</div>
                        </div>
                      </div>
                      <div style={{background:item.color,color:"#fff",borderRadius:99,
                        padding:"6px 16px",fontSize:16,fontWeight:900,flexShrink:0}}>${item.amt}</div>
                    </div>
                    <div style={{height:4,background:item.color+"22",borderRadius:99,overflow:"hidden"}}>
                      <div style={{width:((item.amt/amt)*100).toFixed(0)+"%",height:"100%",background:item.color,borderRadius:99}}/>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",marginTop:5}}>
                      <span style={{fontSize:10,color:"rgba(255,255,255,0.25)",fontWeight:700}}>{((item.amt/amt)*100).toFixed(0)}% of paycheck</span>
                      <span style={{fontSize:10,color:item.color,fontWeight:800}}>{"→ "+item.action}</span>
                    </div>
                  </div>
                ))}

                <div style={{background:"rgba(255,255,255,0.05)",borderRadius:12,padding:"12px 16px",marginBottom:16,...S.sb}}>
                  <span style={{fontSize:13,color:"rgba(255,255,255,0.4)",fontWeight:700}}>Total allocated</span>
                  <span style={{fontSize:15,fontWeight:900,color:"#fff"}}>${fmt(totalAllocated)} / ${fmt(amt)}</span>
                </div>

                {emergencyLeft===0 && (
                  <div style={{background:"rgba(39,174,96,0.08)",border:"1px solid rgba(39,174,96,0.25)",
                    borderRadius:12,padding:"12px 16px",marginBottom:14}}>
                    <div style={{fontSize:13,fontWeight:800,color:"#27AE60"}}>🎉 Emergency Fund Complete!</div>
                    <div style={{fontSize:11,color:"rgba(255,255,255,0.4)",marginTop:3}}>The $375 that was going here now goes straight to your HYSA.</div>
                  </div>
                )}

                {!rothSteps.open && (
                  <div style={{background:"rgba(41,128,185,0.08)",border:"1px solid rgba(41,128,185,0.25)",
                    borderRadius:12,padding:"12px 16px",marginBottom:16}}>
                    <div style={{fontSize:13,fontWeight:800,color:"#2980B9"}}>📈 Roth IRA not opened yet?</div>
                    <div style={{fontSize:11,color:"rgba(255,255,255,0.4)",marginTop:3}}>Go to Fidelity.com → Open Roth IRA → Deposit $100 → Buy VOO. Takes 10 min.</div>
                  </div>
                )}

                <button style={{...S.greenBtn,marginBottom:10}} onClick={()=>setSheet(null)}>
                  Got it — I'll move the money now
                </button>
                <button style={{...S.ghostBtn}} onClick={()=>setSheet(null)}>
                  Remind me later
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── ADD EXPENSE ── */}
      {sheet==="addTx" && (
        <div style={S.overlay} onClick={()=>setSheet(null)}>
          <div style={S.sheet} onClick={e=>e.stopPropagation()}>
            <div style={S.handle}/>
            <div style={S.stitle}>💳 Add Expense</div>
            <div style={S.sbody}>
              <div style={S.fg}>
                <label style={S.flabel}>Description</label>
                <input style={S.input} placeholder="e.g. Chipotle, Gas, Netflix…" value={txForm.label} onChange={e=>setTxForm(p=>({...p,label:e.target.value}))}/>
              </div>
              <div style={S.fg}>
                <label style={S.flabel}>Amount</label>
                <input style={S.input} type="number" inputMode="decimal" placeholder="$0.00" value={txForm.amount} onChange={e=>setTxForm(p=>({...p,amount:e.target.value}))}/>
              </div>
              <div style={S.fg}>
                <label style={S.flabel}>Category</label>
                <select style={S.select} value={txForm.category} onChange={e=>setTxForm(p=>({...p,category:e.target.value}))}>
                  <option value="needs">🏠 Needs</option>
                  <option value="wants">✨ Wants</option>
                  <option value="savings">💰 Savings</option>
                </select>
              </div>
              <div style={{display:"flex",gap:10,marginTop:8,paddingBottom:8}}>
                <button style={{...S.ghostBtn,flex:1}} onClick={()=>setSheet(null)}>Cancel</button>
                <button style={{...S.redBtn,flex:2}} onClick={addTx}>Add Expense</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── GOAL SHEET ── */}
      {sheet==="goal" && activeGoal && (()=>{
        const goal=GOALS.find(g=>g.id===activeGoal);
        if(!goal) return null;
        const prog=gProgress[activeGoal];
        const pct=Math.min((prog/goal.target)*100,100);
        return (
          <div style={S.overlay} onClick={()=>setSheet(null)}>
            <div style={S.sheet} onClick={e=>e.stopPropagation()}>
              <div style={S.handle}/>
              <div style={S.stitle}>{goal.icon} {goal.label}</div>
              <div style={S.sbody}>
                <div style={{background:"rgba(255,255,255,0.05)",borderRadius:14,padding:16,marginBottom:20}}>
                  <div style={{...S.sb,marginBottom:10}}>
                    <span style={{fontSize:13,color:"rgba(255,255,255,0.4)",fontWeight:700}}>Progress</span>
                    <span style={{fontSize:14,fontWeight:800,color:goal.color}}>${fmt(prog)} / ${goal.target.toLocaleString()}</span>
                  </div>
                  <div style={{height:9,background:"rgba(255,255,255,0.1)",borderRadius:99,overflow:"hidden"}}>
                    <div style={{width:pct+"%",height:"100%",background:goal.color,borderRadius:99,transition:"width 0.55s ease"}}/>
                  </div>
                  <div style={{fontSize:12,color:"rgba(255,255,255,0.3)",marginTop:8,fontWeight:600}}>{goal.desc}</div>
                </div>
                <div style={S.fg}>
                  <label style={S.flabel}>Add to this goal</label>
                  <input style={S.input} type="number" inputMode="decimal" placeholder="$0.00" value={goalAmt} onChange={e=>setGoalAmt(e.target.value)}/>
                </div>
                <div style={{display:"flex",gap:10,marginTop:8,paddingBottom:8}}>
                  <button style={{...S.ghostBtn,flex:1}} onClick={()=>setSheet(null)}>Cancel</button>
                  <button style={{...S.redBtn,flex:2,background:goal.color}} onClick={addGoal}>Save Progress</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── CHECKING DETAIL ── */}
      {sheet==="checking" && (
        <div style={S.overlay} onClick={()=>setSheet(null)}>
          <div style={S.sheet} onClick={e=>e.stopPropagation()}>
            <div style={S.handle}/>
            <div style={S.stitle}>Brett's Checking</div>
            <div style={S.sbody}>
              <div style={{background:"rgba(255,255,255,0.05)",borderRadius:16,padding:22,textAlign:"center",marginBottom:20}}>
                <div style={{fontSize:13,color:"rgba(255,255,255,0.35)",fontWeight:700,marginBottom:6}}>Available Balance</div>
                <div className="hero-num" style={{fontSize:42,fontWeight:900,letterSpacing:-1.5}}>${fmt(balance)}</div>
              </div>
              <div style={{...S.sb,marginBottom:13}}><span style={{fontSize:13,color:"rgba(255,255,255,0.45)",fontWeight:600}}>Income This Month</span><span style={{fontSize:15,fontWeight:800,color:"#27AE60"}}>${fmt(monthIncome)}</span></div>
              <div style={{...S.sb,marginBottom:13}}><span style={{fontSize:13,color:"rgba(255,255,255,0.45)",fontWeight:600}}>Spent This Month</span><span style={{fontSize:15,fontWeight:800,color:"#C0392B"}}>${fmt(totalSpent)}</span></div>
              <div style={{...S.sb,marginBottom:13}}><span style={{fontSize:13,color:"rgba(255,255,255,0.45)",fontWeight:600}}>Spent This Week</span><span style={{fontSize:15,fontWeight:800,color:"#E67E22"}}>${fmt(weekTx.reduce((s,t)=>s+t.amount,0))}</span></div>
              <div style={S.divider}/>
              <div style={S.sb}><span style={{fontSize:13,color:"rgba(255,255,255,0.45)",fontWeight:600}}>Savings Rate</span><span style={{fontSize:15,fontWeight:900,color:"#27AE60"}}>{effIncome>0?((actuals.savings/effIncome)*100).toFixed(1):0}%</span></div>
              {incList.length>0 && (
                <div style={{marginTop:20}}>
                  <div style={S.sl}>Recent Income</div>
                  {incList.slice(0,3).map((inc,i)=>(
                    <div key={inc.id} style={{...S.sb,padding:"10px 0",borderBottom:i<Math.min(incList.length,3)-1?"1px solid rgba(255,255,255,0.06)":"none"}}>
                      <div>
                        <div style={{fontSize:13,fontWeight:700,color:"#fff"}}>{inc.label}</div>
                        <div style={{fontSize:11,color:"rgba(255,255,255,0.3)",fontWeight:600}}>{inc.date}</div>
                      </div>
                      <div style={{fontSize:14,fontWeight:800,color:"#27AE60"}}>+${fmt(inc.amount)}</div>
                    </div>
                  ))}
                </div>
              )}
              <button style={{...S.ghostBtn,marginTop:22}} onClick={()=>setSheet(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── PROFILE SHEET ── */}
      {sheet==="profile" && user && (
        <div style={S.overlay} onClick={()=>setSheet(null)}>
          <div style={S.sheet} onClick={e=>e.stopPropagation()}>
            <div style={S.handle}/>
            <div style={S.stitle}>Account</div>
            <div style={S.sbody}>
              <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:24}}>
                {user.photoURL && <img src={user.photoURL} alt="" style={{width:48,height:48,borderRadius:"50%"}}/>}
                <div>
                  <div style={{fontSize:16,fontWeight:800,color:"#fff"}}>{user.displayName}</div>
                  <div style={{fontSize:12,color:"rgba(255,255,255,0.4)",fontWeight:500}}>{user.email}</div>
                </div>
              </div>
              <div style={{background:"rgba(39,174,96,0.08)",border:"1px solid rgba(39,174,96,0.2)",borderRadius:14,padding:"12px 16px",marginBottom:20}}>
                <div style={{fontSize:12,color:"#27AE60",fontWeight:700}}>Data syncing across all your devices</div>
              </div>
              <button style={{...S.ghostBtn,marginBottom:10}} onClick={async()=>{await logOut();setSheet(null);flash2("Signed out");}}>
                Sign Out
              </button>
              <button style={S.ghostBtn} onClick={()=>setSheet(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
