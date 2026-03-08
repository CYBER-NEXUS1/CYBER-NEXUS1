import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  QrCode, 
  CheckCircle2, 
  XCircle, 
  RefreshCw, 
  Settings, 
  Users, 
  ShieldCheck, 
  Zap,
  Clock,
  Terminal
} from 'lucide-react';

interface BotStatus {
  connectionStatus: 'connecting' | 'open' | 'close';
  qrCode: string | null;
  pairingCode: string | null;
  botInfo: {
    runtime: string;
    prefix: string;
    status: string;
  };
  settings: Record<string, boolean>;
}

export default function App() {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [pairingRequested, setPairingRequested] = useState(false);
  const [isDevUrl, setIsDevUrl] = useState(false);

  useEffect(() => {
    setIsDevUrl(window.location.hostname.includes('ais-dev'));
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      setStatus(data);
    } catch (err) {
      console.error('Failed to fetch status', err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    if (!confirm('Are you sure you want to logout and clear the current session?')) return;
    try {
      await fetch('/api/logout', { method: 'POST' });
      fetchStatus();
    } catch (err) {
      console.error('Logout failed', err);
    }
  };

  const requestPairingCode = async (num?: string) => {
    const targetNum = (num || phoneNumber).replace(/[^0-9]/g, '');
    if (!targetNum || targetNum.length < 10) {
      alert("Please enter a valid phone number (e.g., 2348012345678)");
      return;
    }
    
    // If on dev URL, direct them to the pairing page instead of trying to show it in the dashboard
    // because the dashboard might have proxy issues for the socket connection.
    if (isDevUrl) {
      window.open(`/pair/${targetNum}`, '_blank');
      return;
    }

    setPairingRequested(true);
    try {
      await fetch('/api/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: targetNum })
      });
    } catch (err) {
      console.error('Failed to request pairing', err);
      setPairingRequested(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        >
          <RefreshCw className="w-8 h-8 text-emerald-500" />
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#000] text-[#0f0] font-mono selection:bg-[#0f0]/30 overflow-x-hidden">
      {/* Matrix Background Effect */}
      <div className="fixed inset-0 pointer-events-none opacity-10 z-0 overflow-hidden">
        {Array.from({ length: 25 }).map((_, i) => (
          <div 
            key={i}
            className="absolute text-[10px] whitespace-pre animate-matrix-fall"
            style={{ 
              left: `${i * 4}%`, 
              animationDelay: `${Math.random() * 5}s`,
              animationDuration: `${Math.random() * 10 + 10}s`
            }}
          >
            {Array.from({ length: 50 }).map(() => String.fromCharCode(Math.floor(Math.random() * 93) + 33)).join('\n')}
          </div>
        ))}
      </div>

      {/* Header */}
      <header className="border-b border-[#0f0]/20 bg-black/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#0f0] rounded-sm flex items-center justify-center shadow-[0_0_15px_#0f0]">
              <Zap className="w-5 h-5 text-black fill-current" />
            </div>
            <h1 className="font-bold text-xl tracking-widest uppercase">CYBER NEXUS</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className={`flex items-center gap-2 px-3 py-1 rounded-sm text-[10px] font-bold border ${
              status?.connectionStatus === 'open' 
                ? 'bg-[#0f0]/10 text-[#0f0] border-[#0f0]/30' 
                : 'bg-red-500/10 text-red-500 border-red-500/30'
            }`}>
              <div className={`w-1.5 h-1.5 rounded-full ${
                status?.connectionStatus === 'open' ? 'bg-[#0f0] shadow-[0_0_5px_#0f0]' : 'bg-red-500'
              }`} />
              {status?.connectionStatus === 'open' ? 'SYSTEM_ONLINE' : 'SYSTEM_OFFLINE'}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12 space-y-12 relative z-10">
        {/* Proxy Fixer Banner */}
        {isDevUrl && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-sm flex flex-col md:flex-row items-center justify-between gap-4"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-500/20 rounded-full flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-amber-500" />
              </div>
              <div>
                <p className="font-bold text-amber-200">PROXY_DETECTION_ACTIVE</p>
                <p className="text-xs text-amber-500/80">YOU_ARE_ON_DEV_URL. SWITCH_TO_SHARED_URL_TO_AVOID_403_ERRORS.</p>
              </div>
            </div>
            <button 
              onClick={() => window.open('https://ais-pre-37hazmwcwubvshndu4ae43-495065702387.europe-west2.run.app', '_blank')}
              className="bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold px-4 py-2 rounded-sm transition-colors whitespace-nowrap"
            >
              OPEN_SHARED_URL
            </button>
          </motion.div>
        )}

        {/* Hero Section / QR Code */}
        <section className="grid lg:grid-cols-2 gap-12 items-center">
          <div className="space-y-6">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-4"
            >
              <div className="inline-block px-2 py-1 bg-[#0f0]/10 border border-[#0f0]/20 text-[10px] font-bold tracking-widest">
                [ ACCESS_PROTOCOL_v2.0 ]
              </div>
              <h2 className="text-6xl font-black tracking-tighter leading-none uppercase">
                INFILTRATE <br />
                <span className="text-white bg-[#0f0] px-2">WHATSAPP</span>
              </h2>
            </motion.div>
            
            <p className="text-[#0a0] text-lg max-w-md leading-relaxed">
              {'>'} CYBER NEXUS IS A HIGH-LEVEL AUTOMATION CORE. <br />
              {'>'} SCAN THE UPLINK OR USE THE PAIRING SEQUENCE TO ESTABLISH A SECURE CONNECTION.
            </p>
            
            <div className="flex flex-wrap gap-4 pt-4">
              <div className="flex items-center gap-3 bg-[#0f0]/5 border border-[#0f0]/10 px-4 py-3 rounded-sm">
                <Clock className="w-5 h-5 text-[#0f0]" />
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-[#0a0] font-bold">UPTIME</p>
                  <p className="text-sm font-mono">{status?.botInfo.runtime || '00:00:00'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 bg-[#0f0]/5 border border-[#0f0]/10 px-4 py-3 rounded-sm">
                <Terminal className="w-5 h-5 text-[#0f0]" />
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-[#0a0] font-bold">CMD_PREFIX</p>
                  <p className="text-sm font-mono">{status?.botInfo.prefix || '.'}</p>
                </div>
              </div>
            </div>

            {status?.connectionStatus !== 'open' && (
              <div className="pt-8 space-y-6">
                <div className="p-6 bg-[#0f0]/5 border border-[#0f0]/20 rounded-sm space-y-3 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-16 h-16 border-t-2 border-r-2 border-[#0f0]/30" />
                  <p className="text-xs font-bold text-[#0f0] uppercase tracking-widest">[ DIRECT_UPLINK ]</p>
                  <p className="text-sm text-[#0a0]">
                    BYPASS PROXY RESTRICTIONS USING THE DIRECT PAIRING NODE:
                  </p>
                  <div className="bg-black/60 p-3 rounded-sm border border-[#0f0]/20 font-mono text-xs text-[#0f0] break-all shadow-inner">
                    {window.location.origin}/pair/[your_number]
                  </div>
                </div>

                <div className="space-y-4">
                  <p className="text-xs font-bold text-[#0a0] uppercase tracking-widest">{'>'} INITIATE_PAIRING_SEQUENCE</p>
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      placeholder="PHONE_NUMBER (e.g. 234...)" 
                      className="bg-black border border-[#0f0]/30 rounded-sm px-4 py-2 text-sm focus:outline-none focus:border-[#0f0] transition-all w-full max-w-[240px] text-[#0f0] placeholder-[#050]"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                    />
                    <button 
                      onClick={() => requestPairingCode()}
                      disabled={pairingRequested}
                      className="bg-[#0f0] hover:bg-[#0c0] disabled:bg-[#050] text-black font-black py-2 px-6 rounded-sm text-xs transition-all uppercase tracking-widest shadow-[0_0_10px_#0f0]"
                    >
                      {pairingRequested ? 'EXECUTING...' : 'GET_CODE'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-center">
            <AnimatePresence mode="wait">
              {status?.connectionStatus === 'open' ? (
                <motion.div 
                  key="connected"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="w-full max-w-[320px] aspect-square bg-[#0f0]/5 border-2 border-[#0f0] rounded-sm flex flex-col items-center justify-center p-8 text-center space-y-6 shadow-[0_0_30px_#0f0]"
                >
                  <div className="w-20 h-20 bg-[#0f0] rounded-full flex items-center justify-center shadow-[0_0_40px_#0f0]">
                    <CheckCircle2 className="w-10 h-10 text-black" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-2xl font-black uppercase tracking-widest">ACCESS_GRANTED</h3>
                    <p className="text-[#0a0] text-xs">CORE_SYSTEM_ACTIVE. <br /> TYPE <code className="text-[#0f0] font-bold">.menu</code> IN WHATSAPP.</p>
                  </div>
                  <button 
                    onClick={handleLogout}
                    className="mt-4 text-red-500 hover:text-red-400 text-[10px] font-bold transition-colors flex items-center gap-2 uppercase tracking-widest"
                  >
                    <XCircle className="w-3 h-3" />
                    TERMINATE_SESSION
                  </button>
                </motion.div>
              ) : status?.pairingCode ? (
                <motion.div 
                  key="pairing"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="w-full max-w-[320px] aspect-square bg-black border-2 border-[#0f0] rounded-sm flex flex-col items-center justify-center p-8 text-center space-y-8 shadow-[0_0_30px_#0f0]"
                >
                  <div className="w-16 h-16 bg-[#0f0]/10 rounded-sm flex items-center justify-center border border-[#0f0]/30">
                    <Terminal className="w-8 h-8 text-[#0f0]" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-xl font-black uppercase tracking-widest">PAIRING_CODE</h3>
                    <p className="text-[#0a0] text-[10px]">INJECT_CODE_INTO_TARGET_DEVICE</p>
                  </div>
                  <div className="bg-[#0f0]/10 border border-[#0f0]/40 px-8 py-4 rounded-sm">
                    <span className="text-4xl font-mono font-black tracking-[0.3em] text-[#0f0] drop-shadow-[0_0_10px_#0f0]">
                      {status.pairingCode}
                    </span>
                  </div>
                  <button 
                    onClick={() => { setPairingRequested(false); setPhoneNumber(''); }}
                    className="text-[#0a0] hover:text-[#0f0] text-[10px] uppercase tracking-widest border-b border-[#0a0]"
                  >
                    RETURN_TO_UPLINK
                  </button>
                </motion.div>
              ) : status?.qrCode ? (
                <motion.div 
                  key="qr"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="relative group"
                >
                  <div className="absolute -inset-4 bg-[#0f0]/30 blur-3xl rounded-full opacity-50 group-hover:opacity-100 transition-opacity" />
                  <div className="relative bg-[#0f0] p-4 rounded-sm shadow-[0_0_50px_#0f0]">
                    <img src={status.qrCode} alt="UPLINK_QR" className="w-[280px] h-[280px] invert" />
                  </div>
                  <div className="mt-8 flex items-center justify-center gap-3 text-[#0f0] text-xs font-bold uppercase tracking-widest">
                    <QrCode className="w-5 h-5" />
                    SCAN_TO_INFILTRATE
                  </div>
                </motion.div>
              ) : (
                <motion.div 
                  key="connecting"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="w-full max-w-[320px] aspect-square bg-black border border-[#0f0]/20 rounded-sm flex flex-col items-center justify-center p-8 text-center space-y-4"
                >
                  <RefreshCw className="w-10 h-10 text-[#050] animate-spin" />
                  <p className="text-[#050] text-[10px] uppercase tracking-widest">GENERATING_UPLINK...</p>
                  <button 
                    onClick={handleLogout}
                    className="mt-4 text-red-500 hover:text-red-400 text-[10px] font-bold transition-colors uppercase tracking-widest"
                  >
                    RESET_SYSTEM
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </section>

        {/* Features Grid */}
        <section className="grid md:grid-cols-3 gap-6">
          <div className="p-8 bg-black border border-[#0f0]/20 rounded-sm space-y-4 hover:border-[#0f0]/50 transition-all group">
            <div className="w-12 h-12 bg-[#0f0]/10 rounded-sm flex items-center justify-center border border-[#0f0]/20 group-hover:bg-[#0f0]/20">
              <Zap className="w-6 h-6 text-[#0f0]" />
            </div>
            <h3 className="text-xl font-black uppercase tracking-widest">AI_CORE</h3>
            <p className="text-[#0a0] text-xs leading-relaxed">
              POWERED BY GEMINI_2.0_FLASH. ADVANCED COGNITIVE PROCESSING FOR ALL INCOMING DATA STREAMS.
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              {['.ai', '.gpt', '.bot'].map(s => (
                <span key={s} className="text-[9px] px-2 py-1 rounded-sm bg-[#0f0]/10 border border-[#0f0]/20 text-[#0f0] font-bold">
                  {s}
                </span>
              ))}
            </div>
          </div>

          <div className="p-8 bg-black border border-[#0f0]/20 rounded-sm space-y-4 hover:border-[#0f0]/50 transition-all group">
            <div className="w-12 h-12 bg-[#0f0]/10 rounded-sm flex items-center justify-center border border-[#0f0]/20 group-hover:bg-[#0f0]/20">
              <Settings className="w-6 h-6 text-[#0f0]" />
            </div>
            <h3 className="text-xl font-black uppercase tracking-widest">AUTO_SYSTEMS</h3>
            <p className="text-[#0a0] text-xs leading-relaxed">
              AUTOMATED PRESENCE PROTOCOLS. GHOST MODE, AUTO-READ, AND CONTINUOUS UPTIME ENABLED.
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              {['autoread', 'autotyping', 'alwaysonline'].map(s => (
                <span key={s} className={`text-[9px] px-2 py-1 rounded-sm border font-bold ${status?.settings[s] ? 'bg-[#0f0]/20 border-[#0f0] text-[#0f0]' : 'bg-black border-[#0f0]/10 text-[#050]'}`}>
                  {s}
                </span>
              ))}
            </div>
          </div>

          <div className="p-8 bg-black border border-[#0f0]/20 rounded-sm space-y-4 hover:border-[#0f0]/50 transition-all group">
            <div className="w-12 h-12 bg-[#0f0]/10 rounded-sm flex items-center justify-center border border-[#0f0]/20 group-hover:bg-[#0f0]/20">
              <ShieldCheck className="w-6 h-6 text-[#0f0]" />
            </div>
            <h3 className="text-xl font-black uppercase tracking-widest">SEC_PROTOCOLS</h3>
            <p className="text-[#0a0] text-xs leading-relaxed">
              ANTI-LINK, ANTI-SPAM, AND ANTI-TAG SYSTEMS. TOTAL GROUP CONTROL AND PROTECTION.
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              {['antilink', 'antispam', 'antitag'].map(s => (
                <span key={s} className={`text-[9px] px-2 py-1 rounded-sm border font-bold ${status?.settings[s] ? 'bg-[#0f0]/20 border-[#0f0] text-[#0f0]' : 'bg-black border-[#0f0]/10 text-[#050]'}`}>
                  {s}
                </span>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="max-w-5xl mx-auto px-6 py-12 border-t border-[#0f0]/10 flex flex-col md:flex-row justify-between items-center gap-6 text-[#050] text-[10px] uppercase tracking-[0.2em] font-bold">
        <p>© 2026 CYBER NEXUS // ALL_RIGHTS_RESERVED</p>
        <div className="flex gap-8">
          <a href="#" className="hover:text-[#0f0] transition-colors">DOCS</a>
          <a href="#" className="hover:text-[#0f0] transition-colors">UPLINK_STATUS</a>
          <a href="#" className="hover:text-[#0f0] transition-colors">PRIVACY_PROTOCOL</a>
        </div>
      </footer>
    </div>
  );
}
