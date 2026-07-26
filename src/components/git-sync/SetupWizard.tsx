import React, { useState } from 'react';
import { User, Mail, Key, Github, ArrowRight, Loader2, Save, CheckCircle, XCircle, Wifi, WifiOff, ExternalLink, Copy, RefreshCw } from 'lucide-react';

interface SetupWizardProps {
  onComplete: () => void;
  api: (endpoint: string, options?: RequestInit) => Promise<any>;
  showToast: (msg: string, type: string) => void;
}

export default function SetupWizard({ onComplete, api, showToast }: SetupWizardProps) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [testResult, setTestResult] = useState<{ connected: boolean; username?: string; error?: string } | null>(null);

  const saveIdentity = async () => {
    if (!name.trim() || !email.trim()) { showToast('Enter both name and email', 'error'); return; }
    setLoading(true);
    try {
      const r = await api('/github/setup', { method: 'POST', body: JSON.stringify({ name: name.trim(), email: email.trim() }) });
      if (r.success) { showToast('Identity saved!', 'success'); setStep(2); }
      else showToast('Failed: ' + r.error, 'error');
    } catch (e: any) { showToast('Failed: ' + e.message, 'error'); }
    setLoading(false);
  };

  const generateKey = async () => {
    setLoading(true);
    try {
      const r = await api('/github/generate-key', { method: 'POST', body: JSON.stringify({ email, force: false }) });
      if (r.success) { setPublicKey(r.publicKey); showToast('SSH key generated!', 'success'); }
      else showToast('Failed: ' + r.error, 'error');
    } catch (e: any) { showToast('Failed: ' + e.message, 'error'); }
    setLoading(false);
  };

  const testConnection = async () => {
    setLoading(true);
    setTestResult(null);
    try {
      const r = await api('/github/test-connection', { method: 'POST' });
      setTestResult(r);
      if (r.connected) { showToast(`Connected as @${r.username}!`, 'success'); }
      else showToast('Connection failed', 'error');
    } catch (e: any) { showToast('Failed: ' + e.message, 'error'); }
    setLoading(false);
  };

  const copyKey = () => {
    if (!publicKey) return;
    navigator.clipboard.writeText(publicKey).then(() => showToast('Copied!', 'success')).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = publicKey;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('Copied!', 'success');
    });
  };

  return (
    <div className="h-full overflow-y-auto p-4 lg:p-8">
      <div className="max-w-xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent/10 border border-accent/20 mb-4">
            <Github className="w-8 h-8 text-accent" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Connect to GitHub</h1>
          <p className="text-muted text-sm">Set up Git and SSH to sync your repositories</p>
        </div>

        {/* Progress */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {[1, 2].map(s => (
            <React.Fragment key={s}>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold transition-all
                ${step > s ? 'bg-emerald-500 text-white' : step === s ? 'bg-accent text-white' : 'bg-dark-700 text-subtle'}`}>
                {step > s ? <CheckCircle className="w-5 h-5" /> : s}
              </div>
              {s < 2 && <div className={`w-12 h-0.5 rounded transition-all ${step > s ? 'bg-emerald-500' : 'bg-dark-700'}`} />}
            </React.Fragment>
          ))}
        </div>

        {/* Step 1: Identity */}
        {step === 1 && (
          <div className="bg-dark-800 border border-dark-700 rounded-xl p-6">
            <h2 className="text-white font-semibold mb-4 flex items-center gap-2"><User className="w-5 h-5 text-accent" /> Git Identity</h2>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-muted mb-1.5 block">Full Name</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name"
                  className="w-full bg-dark-900 border border-dark-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-dark-500 focus:border-accent outline-none" />
              </div>
              <div>
                <label className="text-xs text-muted mb-1.5 block">Email</label>
                <input value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com" type="email"
                  className="w-full bg-dark-900 border border-dark-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-dark-500 focus:border-accent outline-none" />
              </div>
              <button onClick={saveIdentity} disabled={loading}
                className="w-full px-4 py-2.5 bg-accent hover:bg-accent/80 text-white rounded-lg text-sm font-medium transition flex items-center justify-center gap-2 disabled:opacity-50">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step 2: SSH Key */}
        {step === 2 && (
          <div className="bg-dark-800 border border-dark-700 rounded-xl p-6">
            <h2 className="text-white font-semibold mb-4 flex items-center gap-2"><Key className="w-5 h-5 text-accent" /> SSH Key</h2>
            {publicKey ? (
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-muted mb-1.5 block">Your SSH Public Key</label>
                  <div className="bg-dark-900 border border-dark-700 rounded-lg p-3 font-mono text-xs text-dark-300 break-all max-h-32 overflow-y-auto select-all">
                    {publicKey}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={copyKey} className="px-3 py-2 bg-dark-700 hover:bg-dark-600 text-dark-200 text-xs rounded-lg transition flex items-center gap-1.5">
                    <Copy className="w-3.5 h-3.5" /> Copy Key
                  </button>
                  <a href="https://github.com/settings/ssh/new" target="_blank" rel="noopener noreferrer"
                    className="px-3 py-2 bg-accent/10 hover:bg-accent/20 text-accent text-xs rounded-lg transition flex items-center gap-1.5 border border-accent/20">
                    <ExternalLink className="w-3.5 h-3.5" /> Add to GitHub
                  </a>
                  <button onClick={generateKey} disabled={loading}
                    className="px-3 py-2 bg-dark-700 hover:bg-dark-600 text-muted text-xs rounded-lg transition flex items-center gap-1.5 disabled:opacity-50">
                    {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Regenerate
                  </button>
                </div>
                <div className="bg-dark-900/50 border border-dark-700 rounded-lg p-3 space-y-1.5">
                  <p className="text-xs text-muted font-medium">📋 Instructions:</p>
                  <p className="text-xs text-subtle">1. Copy the key above</p>
                  <p className="text-xs text-subtle">2. Click "Add to GitHub" to open GitHub settings</p>
                  <p className="text-xs text-subtle">3. Paste the key and save</p>
                  <p className="text-xs text-subtle">4. Come back and click "Test Connection"</p>
                </div>
                {testResult?.connected ? (
                  <div className="text-center py-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                    <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                    <p className="text-white font-semibold">Connected to GitHub!</p>
                    <p className="text-muted text-sm">Authenticated as @{testResult.username}</p>
                  </div>
                ) : testResult && !testResult.connected ? (
                  <div className="text-center py-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                    <XCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
                    <p className="text-white font-semibold">Connection Failed</p>
                    <p className="text-muted text-sm mb-2">Make sure you've added your SSH key to GitHub</p>
                    {testResult.error && <pre className="bg-dark-900 rounded p-2 text-xs text-red-400/70 font-mono max-h-20 overflow-auto">{testResult.error}</pre>}
                    <button onClick={testConnection} disabled={loading}
                      className="mt-3 px-4 py-2 bg-accent hover:bg-accent/80 text-white text-sm rounded-lg transition flex items-center gap-1.5 mx-auto disabled:opacity-50">
                      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Try Again
                    </button>
                  </div>
                ) : (
                  <button onClick={testConnection} disabled={loading}
                    className="w-full px-4 py-2.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded-lg text-sm font-medium transition flex items-center justify-center gap-2 disabled:opacity-50">
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
                    Test Connection
                  </button>
                )}
                {testResult?.connected && (
                  <button onClick={onComplete}
                    className="w-full px-4 py-2.5 bg-accent hover:bg-accent/80 text-white rounded-lg text-sm font-medium transition flex items-center justify-center gap-2">
                    <ArrowRight className="w-4 h-4" /> Continue to Git Sync
                  </button>
                )}
              </div>
            ) : (
              <div className="text-center py-6">
                <Key className="w-12 h-12 text-subtle mx-auto mb-4" />
                <p className="text-muted text-sm mb-4">Generate an SSH key for GitHub authentication</p>
                <button onClick={generateKey} disabled={loading}
                  className="px-6 py-2.5 bg-accent hover:bg-accent/80 text-white rounded-lg text-sm font-medium transition flex items-center justify-center gap-2 mx-auto disabled:opacity-50">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
                  Generate SSH Key
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}