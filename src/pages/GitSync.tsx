import React, { useState, useEffect, useCallback } from 'react';
import { GitBranch, RefreshCw, Download, Upload, Eye, Undo2, Save, GitCommitHorizontal, Activity, FolderGit2, X, Key, User, Mail, Wifi, WifiOff, ExternalLink, Copy, CheckCircle, XCircle, Settings, Unlink, ArrowRight, Github, Loader2, ShieldCheck, AlertTriangle, Archive, ArchiveRestore, GitCompare, DownloadCloud, Info, GitBranchPlus, Tag, Trash2 } from 'lucide-react';

const api = async (endpoint: string, options: RequestInit = {}) => {
  const token = localStorage.getItem('vps_token');
  const res = await fetch(`/api/git${endpoint}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers },
  });
  return res.json();
};

interface Repo { path: string; branch: string; remote: string; }
interface FileChange { status: string; file: string; }
interface Commit { hash: string; message: string; author: string; time: string; }
interface SyncConf { enabled: boolean; intervalSeconds: number; autoPush: boolean; autoPull: boolean; autoResolveConflicts: boolean; commitMessage: string; pm2App?: string; }
interface GHStatus {
  configured: boolean;
  gitUser: { name: string | null; email: string | null };
  sshKey: { exists: boolean; type: string | null; publicKey: string | null };
  github: { connected: boolean; username: string | null };
}

const defaultSync: SyncConf = { enabled: false, intervalSeconds: 30, autoPush: true, autoPull: true, autoResolveConflicts: true, commitMessage: 'auto-sync: {timestamp}', pm2App: '' };

export default function GitSync() {
  // GitHub setup state
  const [ghStatus, setGhStatus] = useState<GHStatus | null>(null);
  const [ghLoading, setGhLoading] = useState(true);
  const [setupStep, setSetupStep] = useState(1);
  const [setupName, setSetupName] = useState('');
  const [setupEmail, setSetupEmail] = useState('');
  const [sshPublicKey, setSshPublicKey] = useState('');
  const [testResult, setTestResult] = useState<{ connected: boolean; username?: string; error?: string } | null>(null);
  const [setupBusy, setSetupBusy] = useState(false);
  const [accessMode, setAccessMode] = useState<'full' | 'deploy'>('full');
  const [deployRepo, setDeployRepo] = useState(''); // e.g. "username/repo"
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cloneUrl, setCloneUrl] = useState('');
  const [clonePath, setClonePath] = useState('');
  const [cloneBusy, setCloneBusy] = useState(false);

  // Git repo state
  const [repos, setRepos] = useState<Repo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [branch, setBranch] = useState('');
  const [branches, setBranches] = useState<Array<{ name: string; isCurrent: boolean; isRemote: boolean }>>([]);
  const [remoteUrl, setRemoteUrl] = useState('');
  const [lastCommit, setLastCommit] = useState<any>(null);
  const [changes, setChanges] = useState<FileChange[]>([]);
  const [ahead, setAhead] = useState(0);
  const [behind, setBehind] = useState(0);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [commitMsg, setCommitMsg] = useState('');
  const [tab, setTab] = useState<'changes' | 'log' | 'branches' | 'tags' | 'sync'>('changes');
  const [tags, setTags] = useState<Array<{ name: string; message: string }>>([]);
  const [createBranchModal, setCreateBranchModal] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [createTagModal, setCreateTagModal] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagMessage, setNewTagMessage] = useState('');
  const [syncConf, setSyncConf] = useState<SyncConf>(defaultSync);
  const [syncStatus, setSyncStatus] = useState<{ running: boolean; pid: number | null; logs: string }>({ running: false, pid: null, logs: '' });
  const [syncConfigs, setSyncConfigs] = useState<Record<string, SyncConf>>({});
  const [diffModal, setDiffModal] = useState<{ file: string; diff: string } | null>(null);
  const [pm2Apps, setPm2Apps] = useState<string[]>([]);
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [mobileShowSidebar, setMobileShowSidebar] = useState(true);

  const showToast = (msg: string, type = 'info') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  // Check GitHub status on mount
  const checkGHStatus = useCallback(async () => {
    setGhLoading(true);
    try {
      const data = await api('/github/status');
      setGhStatus(data);
      if (data.gitUser?.name) setSetupName(data.gitUser.name);
      if (data.gitUser?.email) setSetupEmail(data.gitUser.email);
      if (data.sshKey?.publicKey) setSshPublicKey(data.sshKey.publicKey);
      // Auto-advance setup step
      if (data.gitUser?.name && data.gitUser?.email) {
        if (data.sshKey?.exists) {
          setSetupStep(3);
        } else {
          setSetupStep(2);
        }
      } else {
        setSetupStep(1);
      }
    } catch {
      // If check fails, assume configured and show normal view
      setGhStatus({ configured: true, gitUser: { name: null, email: null }, sshKey: { exists: false, type: null, publicKey: null }, github: { connected: false, username: null } });
    }
    setGhLoading(false);
  }, []);

  useEffect(() => { checkGHStatus(); }, [checkGHStatus]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!selected) return;
      if (e.ctrlKey && e.key === 's') { e.preventDefault(); handleCommitAndPush(); }
      if (e.ctrlKey && e.key === 'r') { e.preventDefault(); refreshStatus(); }
      if (e.ctrlKey && e.key === 'b') { e.preventDefault(); setCreateBranchModal(true); }
      if (e.ctrlKey && e.key === 't') { e.preventDefault(); setCreateTagModal(true); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [selected, commitMsg]);

  // ── Setup handlers ──
  const saveIdentity = async () => {
    if (!setupName.trim() || !setupEmail.trim()) { showToast('Enter both name and email', 'error'); return; }
    setSetupBusy(true);
    const r = await api('/github/setup', { method: 'POST', body: JSON.stringify({ name: setupName.trim(), email: setupEmail.trim() }) });
    setSetupBusy(false);
    if (r.success) { showToast('Identity saved!', 'success'); setSetupStep(2); checkGHStatus(); }
    else showToast('Failed: ' + r.error, 'error');
  };

  const generateKey = async (force = false) => {
    setSetupBusy(true);
    const r = await api('/github/generate-key', { method: 'POST', body: JSON.stringify({ email: setupEmail, force }) });
    setSetupBusy(false);
    if (r.success) {
      setSshPublicKey(r.publicKey);
      showToast('SSH key generated!', 'success');
      // Stay on step 2 so user can copy key and add to GitHub
      setGhStatus(prev => prev ? { ...prev, sshKey: { exists: true, type: 'ed25519', publicKey: r.publicKey } } : prev);
    }
    else showToast('Failed: ' + r.error, 'error');
  };

  const testConnection = async () => {
    setSetupBusy(true);
    setTestResult(null);
    const r = await api('/github/test-connection', { method: 'POST' });
    setSetupBusy(false);
    setTestResult(r);
    if (r.connected) { showToast(`Connected as @${r.username}!`, 'success'); checkGHStatus(); }
    else showToast('Connection failed', 'error');
  };

  const disconnect = async () => {
    if (!confirm('This will remove your SSH keys and git config. Are you sure?')) return;
    const r = await api('/github/disconnect', { method: 'POST' });
    if (r.success) { showToast('Disconnected', 'success'); setSettingsOpen(false); checkGHStatus(); }
    else showToast('Failed: ' + r.error, 'error');
  };

  const cloneRepo = async () => {
    if (!cloneUrl.trim() || !clonePath.trim()) { showToast('Enter URL and path', 'error'); return; }
    setCloneBusy(true);
    const r = await api('/github/clone', { method: 'POST', body: JSON.stringify({ url: cloneUrl.trim(), path: clonePath.trim() }) });
    setCloneBusy(false);
    if (r.success) { showToast('Cloned!', 'success'); setCloneUrl(''); setClonePath(''); loadRepos(); }
    else showToast('Clone failed: ' + r.error, 'error');
  };

  const copyKey = () => {
    try {
      // Try modern API first (works on HTTPS/localhost)
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(sshPublicKey).then(() => showToast('Copied!', 'success')).catch(() => fallbackCopy());
      } else {
        fallbackCopy();
      }
    } catch { fallbackCopy(); }
  };

  const fallbackCopy = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = sshPublicKey;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('Copied!', 'success');
    } catch { showToast('Copy failed — select and copy manually', 'error'); }
  };

  // ── Git repo handlers (same as before) ──
  const loadRepos = useCallback(async () => {
    const data = await api('/repos');
    setRepos(data.repos || []);
    const sc = await api('/sync/config');
    setSyncConfigs(sc.repos || {});
  }, []);

  const loadSyncStatus = useCallback(async () => {
    const data = await api('/sync/status');
    setSyncStatus(data);
  }, []);

  const loadPm2Apps = useCallback(async () => {
    try {
      const res = await fetch('/api/pm2/list', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
      const apps = await res.json();
      setPm2Apps(Array.isArray(apps) ? apps.map((a: any) => a.name) : []);
    } catch {}
  }, []);

  useEffect(() => {
    if (ghStatus?.configured) { loadRepos(); loadSyncStatus(); loadPm2Apps(); const i = setInterval(loadSyncStatus, 10000); return () => clearInterval(i); }
  }, [ghStatus?.configured]);

  const selectRepo = async (repoPath: string) => {
    setSelected(repoPath);
    setTab('changes');
    loadBranches();
    loadTags();
    setMobileShowSidebar(false);
    const [info, status, log, sc] = await Promise.all([
      api(`/info?repo=${encodeURIComponent(repoPath)}`),
      api(`/status?repo=${encodeURIComponent(repoPath)}`),
      api(`/log?repo=${encodeURIComponent(repoPath)}&limit=20`),
      api('/sync/config'),
    ]);
    if (!info.error) { setBranch(info.branch); setBranches(info.branches?.filter((b: string) => !b.startsWith('remotes/')) || []); setRemoteUrl(info.remotes?.[0]?.url || ''); setLastCommit(info.lastCommit); }
    if (!status.error) { setChanges(status.files || []); setAhead(status.ahead || 0); setBehind(status.behind || 0); }
    if (!log.error) { setCommits(log.commits || []); }
    setSyncConf(sc.repos?.[repoPath] || defaultSync);
    setSyncConfigs(sc.repos || {});
  };

  const refreshStatus = async () => {
    if (!selected) return;
    const status = await api(`/status?repo=${encodeURIComponent(selected)}`);
    if (!status.error) { setChanges(status.files || []); setAhead(status.ahead || 0); setBehind(status.behind || 0); }
  };

  useEffect(() => { if (selected) { const i = setInterval(refreshStatus, 10000); return () => clearInterval(i); } }, [selected]);

  const stageAll = async () => { await api('/stage', { method: 'POST', body: JSON.stringify({ repo: selected, files: ['.'] }) }); refreshStatus(); showToast('All files staged', 'success'); };
  const commitAndPush = async () => {
    if (!commitMsg.trim()) { showToast('Enter a commit message', 'error'); return; }
    setLoading(true);
    await api('/stage', { method: 'POST', body: JSON.stringify({ repo: selected, files: ['.'] }) });
    const cr = await api('/commit', { method: 'POST', body: JSON.stringify({ repo: selected, message: commitMsg }) });
    if (cr.error) { showToast('Commit failed: ' + cr.error, 'error'); setLoading(false); return; }
    const pr = await api('/push', { method: 'POST', body: JSON.stringify({ repo: selected }) });
    if (pr.error) { showToast('Push failed: ' + pr.error, 'error'); setLoading(false); return; }
    setCommitMsg(''); showToast('Committed & pushed!', 'success'); selectRepo(selected!); setLoading(false);
  };
  const pull = async () => { showToast('Pulling...', 'info'); const r = await api('/pull', { method: 'POST', body: JSON.stringify({ repo: selected }) }); if (r.error) { showToast('Pull failed: ' + r.error, 'error'); return; } showToast('Pulled!', 'success'); selectRepo(selected!); };
  const push = async () => { showToast('Pushing...', 'info'); const r = await api('/push', { method: 'POST', body: JSON.stringify({ repo: selected }) }); if (r.error) { showToast('Push failed: ' + r.error, 'error'); return; } showToast('Pushed!', 'success'); selectRepo(selected!); };
  const viewDiff = async (file: string) => { const d = await api(`/diff?repo=${encodeURIComponent(selected!)}&file=${encodeURIComponent(file)}`); setDiffModal({ file, diff: d.diff || 'No changes' }); };
  const discardFile = async (file: string) => { if (!confirm(`Discard changes to ${file}?`)) return; await api('/discard', { method: 'POST', body: JSON.stringify({ repo: selected, file }) }); showToast('Discarded', 'success'); refreshStatus(); };
  const switchBranch = async (br: string) => { const r = await api('/checkout', { method: 'POST', body: JSON.stringify({ repo: selected, branch: br }) }); if (r.error) { showToast('Switch failed: ' + r.error, 'error'); return; } showToast(`Switched to ${br}`, 'success'); selectRepo(selected!); };
  const saveSyncSettings = async (conf?: SyncConf) => { const c = conf || syncConf; const r = await api('/sync/config', { method: 'POST', body: JSON.stringify({ repo: selected, ...c }) }); if (r.error) { showToast('Save failed: ' + r.error, 'error'); return; } showToast(c.enabled ? 'Auto-sync enabled!' : 'Auto-sync disabled!', 'success'); loadRepos(); };

  const handleCommitAndPush = async () => {
    if (!commitMsg.trim()) { showToast('Enter a commit message', 'error'); return; }
    await commitAndPush();
  };

  const handleStash = async () => {
    if (!selected) return;
    const r = await api('/stash', { method: 'POST', body: JSON.stringify({ repo: selected, message: 'WIP' }) });
    if (r.success) { showToast(r.stashed ? 'Changes stashed!' : r.message, r.stashed ? 'success' : 'info'); refreshStatus(); }
  };

  const handleUnstash = async () => {
    if (!selected) return;
    const r = await api('/stash/pop', { method: 'POST', body: JSON.stringify({ repo: selected }) });
    if (r.success) { showToast('Stash popped!', 'success'); refreshStatus(); }
  };

  const handleCreateBranch = async () => {
    if (!selected || !newBranchName.trim()) return;
    const r = await api('/branch/create', { method: 'POST', body: JSON.stringify({ repo: selected, name: newBranchName.trim() }) });
    if (r.success) { showToast(`Created branch ${newBranchName}!`, 'success'); setNewBranchName(''); setCreateBranchModal(false); loadBranches(); }
  };

  const handleDeleteBranch = async (branchName: string) => {
    if (branchName === branch) return showToast("Can't delete current branch", 'error');
    if (!confirm(`Delete branch ${branchName}?`)) return;
    const r = await api('/branch/delete', { method: 'POST', body: JSON.stringify({ repo: selected, name: branchName }) });
    if (r.success) { showToast(`Deleted branch ${branchName}`, 'success'); loadBranches(); }
  };

  const handleSwitchBranch = async (branchName: string) => {
    if (branchName === branch) return;
    if (!confirm(`Switch to branch ${branchName}? Uncommitted changes may be lost.`)) return;
    const r = await api('/branch/checkout', { method: 'POST', body: JSON.stringify({ repo: selected, branch: branchName }) });
    if (r.success) { showToast(`Switched to ${branchName}`, 'success'); loadBranches(); refreshStatus(); }
  };

  const loadBranches = async () => {
    if (!selected) return;
    const r = await api('/branches?repo=' + encodeURIComponent(selected));
    if (r.branches) { setBranches(r.branches); if (r.current) setBranch(r.current); }
  };

  const handleCreateTag = async () => {
    if (!selected || !newTagName.trim()) return;
    const r = await api('/tag/create', { method: 'POST', body: JSON.stringify({ repo: selected, name: newTagName.trim(), message: newTagMessage.trim() }) });
    if (r.success) { showToast(`Created tag ${newTagName}!`, 'success'); setNewTagName(''); setNewTagMessage(''); setCreateTagModal(false); loadTags(); }
  };

  const handleDeleteTag = async (tagName: string) => {
    if (!confirm(`Delete tag ${tagName}?`)) return;
    const r = await api('/tag', { method: 'DELETE', body: JSON.stringify({ repo: selected, name: tagName }) });
    if (r.success) { showToast(`Deleted tag ${tagName}`, 'success'); loadTags(); }
  };

  const loadTags = async () => {
    if (!selected) return;
    const r = await api('/tags?repo=' + encodeURIComponent(selected));
    if (r.tags) setTags(r.tags);
  };

  const statusColor = (s: string) => s === 'M' ? 'text-amber-400 bg-amber-400/10' : s === 'D' ? 'text-red-400 bg-red-400/10' : (s === '??' || s === 'A') ? 'text-emerald-400 bg-emerald-400/10' : 'text-blue-400 bg-blue-400/10';
  const statusLabel = (s: string) => s === 'M' ? 'Modified' : s === 'D' ? 'Deleted' : s === '??' ? 'New' : s === 'A' ? 'Added' : s;

  // ── Loading state ──
  if (ghLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    );
  }

  // ──────────────────────────────────────────────
  //  SETUP WIZARD (when GitHub is not configured)
  // ──────────────────────────────────────────────
  if (ghStatus && !ghStatus.configured) {
    return (
      <div className="h-full overflow-y-auto p-4 lg:p-8">
        {/* Toast */}
        {toast && (
          <div className={`fixed top-4 right-4 z-[100] px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg
            ${toast.type === 'success' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
              toast.type === 'error' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
              'bg-blue-500/20 text-blue-400 border border-blue-500/30'}`}>
            {toast.msg}
          </div>
        )}

        <div className="max-w-2xl mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-card bg-accent/10 border border-accent/20 mb-4">
              <Github className="w-8 h-8 text-accent" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Connect to GitHub</h1>
            <p className="text-muted text-sm">Set up Git and SSH to sync your repositories</p>
          </div>

          {/* Progress bar */}
          <div className="flex items-center gap-2 mb-8 px-4">
            {[1, 2, 3].map(s => (
              <React.Fragment key={s}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-all
                  ${setupStep > s ? 'bg-emerald-500 text-white' : setupStep === s ? 'bg-accent text-white' : 'bg-raised text-subtle'}`}>
                  {setupStep > s ? <CheckCircle className="w-4 h-4" /> : s}
                </div>
                {s < 3 && <div className={`flex-1 h-0.5 rounded transition-all ${setupStep > s ? 'bg-emerald-500' : 'bg-raised'}`} />}
              </React.Fragment>
            ))}
          </div>

          {/* Step 1: Git Identity */}
          <div className={`mb-4 bg-surface border rounded-control overflow-hidden transition-all
            ${setupStep === 1 ? 'border-accent/30' : setupStep > 1 ? 'border-emerald-500/30' : 'border-line opacity-50'}`}>
            <div className="flex items-center gap-3 px-5 py-4 cursor-pointer" onClick={() => setupStep >= 1 && setSetupStep(1)}>
              <div className={`w-10 h-10 rounded-control flex items-center justify-center
                ${setupStep > 1 ? 'bg-emerald-500/10 text-emerald-400' : setupStep === 1 ? 'bg-accent/10 text-accent' : 'bg-raised text-subtle'}`}>
                <User className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h3 className="text-white font-semibold text-sm">Git Identity</h3>
                <p className="text-subtle text-xs">Name and email for commits</p>
              </div>
              {setupStep > 1 && <CheckCircle className="w-5 h-5 text-emerald-400" />}
            </div>
            {setupStep === 1 && (
              <div className="px-5 pb-5 border-t border-line pt-4 space-y-3">
                <div>
                  <label className="text-xs text-muted mb-1 block">Full Name</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle" />
                    <input value={setupName} onChange={e => setSetupName(e.target.value)} placeholder="Your name"
                      className="w-full bg-canvas border border-line rounded-lg pl-10 pr-3 py-2.5 text-sm text-white placeholder-dark-500 focus:border-accent outline-none" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted mb-1 block">Email</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle" />
                    <input value={setupEmail} onChange={e => setSetupEmail(e.target.value)} placeholder="your@email.com" type="email"
                      className="w-full bg-canvas border border-line rounded-lg pl-10 pr-3 py-2.5 text-sm text-white placeholder-dark-500 focus:border-accent outline-none" />
                  </div>
                </div>
                <button onClick={saveIdentity} disabled={setupBusy}
                  className="w-full px-4 py-2.5 bg-accent hover:bg-accent/80 text-white rounded-lg text-sm font-medium transition flex items-center justify-center gap-2 disabled:opacity-50">
                  {setupBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save & Continue
                </button>
              </div>
            )}
          </div>

          {/* Step 2: SSH Key */}
          <div className={`mb-4 bg-surface border rounded-control overflow-hidden transition-all
            ${setupStep === 2 ? 'border-accent/30' : setupStep > 2 ? 'border-emerald-500/30' : 'border-line opacity-50'}`}>
            <div className="flex items-center gap-3 px-5 py-4 cursor-pointer" onClick={() => setupStep >= 2 && setSetupStep(2)}>
              <div className={`w-10 h-10 rounded-control flex items-center justify-center
                ${setupStep > 2 ? 'bg-emerald-500/10 text-emerald-400' : setupStep === 2 ? 'bg-accent/10 text-accent' : 'bg-raised text-subtle'}`}>
                <Key className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h3 className="text-white font-semibold text-sm">SSH Key</h3>
                <p className="text-subtle text-xs">Secure authentication with GitHub</p>
              </div>
              {setupStep > 2 && <CheckCircle className="w-5 h-5 text-emerald-400" />}
            </div>
            {setupStep === 2 && (
              <div className="px-5 pb-5 border-t border-line pt-4 space-y-4">
                {/* Access Mode Selector */}
                {!(ghStatus.sshKey.exists && sshPublicKey) && (
                  <div className="space-y-3">
                    <label className="text-xs text-muted font-medium block">Access Level</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <button onClick={() => setAccessMode('full')}
                        className={`text-left p-3 rounded-lg border transition-all ${accessMode === 'full'
                          ? 'border-accent/40 bg-accent/5'
                          : 'border-line bg-canvas hover:border-line'}`}>
                        <div className="flex items-center gap-2 mb-1">
                          <Github className={`w-4 h-4 ${accessMode === 'full' ? 'text-accent' : 'text-subtle'}`} />
                          <span className={`text-sm font-medium ${accessMode === 'full' ? 'text-white' : 'text-muted'}`}>Full Account</span>
                        </div>
                        <p className="text-[11px] text-subtle">Access all your repositories</p>
                      </button>
                      <button onClick={() => setAccessMode('deploy')}
                        className={`text-left p-3 rounded-lg border transition-all ${accessMode === 'deploy'
                          ? 'border-accent/40 bg-accent/5'
                          : 'border-line bg-canvas hover:border-line'}`}>
                        <div className="flex items-center gap-2 mb-1">
                          <ShieldCheck className={`w-4 h-4 ${accessMode === 'deploy' ? 'text-accent' : 'text-subtle'}`} />
                          <span className={`text-sm font-medium ${accessMode === 'deploy' ? 'text-white' : 'text-muted'}`}>Single Repo</span>
                        </div>
                        <p className="text-[11px] text-subtle">Deploy key for one repository</p>
                      </button>
                    </div>
                    {accessMode === 'deploy' && (
                      <div>
                        <label className="text-xs text-muted mb-1 block">Repository (owner/repo)</label>
                        <input value={deployRepo} onChange={e => setDeployRepo(e.target.value)} placeholder="username/repo-name"
                          className="w-full bg-canvas border border-line rounded-lg px-3 py-2.5 text-sm text-white placeholder-dark-500 focus:border-accent outline-none" />
                      </div>
                    )}
                  </div>
                )}

                {ghStatus.sshKey.exists && sshPublicKey ? (
                  <>
                    <div>
                      <label className="text-xs text-muted mb-1.5 block">Your SSH Public Key</label>
                      <div className="bg-canvas border border-line rounded-lg p-3 font-mono text-xs text-muted break-all max-h-24 overflow-y-auto select-all">
                        {sshPublicKey}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={copyKey} className="px-3 py-2 bg-raised hover:bg-raised text-ink text-xs rounded-lg transition flex items-center gap-1.5">
                        <Copy className="w-3.5 h-3.5" /> Copy Key
                      </button>
                      {accessMode === 'deploy' && deployRepo ? (
                        <a href={`https://github.com/${deployRepo}/settings/keys/new`} target="_blank" rel="noopener noreferrer"
                          className="px-3 py-2 bg-accent/10 hover:bg-accent/20 text-accent text-xs rounded-lg transition flex items-center gap-1.5 border border-accent/20">
                          <ExternalLink className="w-3.5 h-3.5" /> Add Deploy Key
                        </a>
                      ) : (
                        <a href="https://github.com/settings/ssh/new" target="_blank" rel="noopener noreferrer"
                          className="px-3 py-2 bg-accent/10 hover:bg-accent/20 text-accent text-xs rounded-lg transition flex items-center gap-1.5 border border-accent/20">
                          <ExternalLink className="w-3.5 h-3.5" /> Add to GitHub
                        </a>
                      )}
                      <button onClick={() => generateKey(true)} className="px-3 py-2 bg-raised hover:bg-raised text-muted text-xs rounded-lg transition flex items-center gap-1.5">
                        <RefreshCw className="w-3.5 h-3.5" /> Regenerate
                      </button>
                    </div>
                    <div className="bg-canvas/50 border border-line rounded-lg p-3 space-y-1.5">
                      {accessMode === 'deploy' && deployRepo ? (
                        <>
                          <p className="text-xs text-muted font-medium">🔒 Deploy Key — single repo access</p>
                          <p className="text-xs text-subtle">1. Copy the key above</p>
                          <p className="text-xs text-subtle">2. Click "Add Deploy Key" to open <span className="text-muted font-medium">{deployRepo}</span> settings</p>
                          <p className="text-xs text-subtle">3. Give it a title, paste the key, check "Allow write access" if needed</p>
                          <p className="text-xs text-subtle">4. Come back and proceed to step 3</p>
                        </>
                      ) : (
                        <>
                          <p className="text-xs text-muted font-medium">📋 Full access — all repositories</p>
                          <p className="text-xs text-subtle">1. Copy the key above</p>
                          <p className="text-xs text-subtle">2. Click "Add to GitHub" to open GitHub settings</p>
                          <p className="text-xs text-subtle">3. Paste the key and save</p>
                          <p className="text-xs text-subtle">4. Come back and proceed to step 3</p>
                        </>
                      )}
                    </div>
                    <button onClick={() => setSetupStep(3)}
                      className="w-full px-4 py-2.5 bg-accent hover:bg-accent/80 text-white rounded-lg text-sm font-medium transition flex items-center justify-center gap-2">
                      <ArrowRight className="w-4 h-4" /> Continue to Verify
                    </button>
                  </>
                ) : (
                  <div className="text-center py-4">
                    <Key className="w-10 h-10 text-subtle mx-auto mb-3" />
                    <p className="text-muted text-sm mb-4">
                      {accessMode === 'deploy' ? 'Generate a deploy key for single-repo access' : 'Generate an SSH key for GitHub authentication'}
                    </p>
                    <button onClick={() => generateKey(false)} disabled={setupBusy || (accessMode === 'deploy' && !deployRepo.trim())}
                      className="px-6 py-2.5 bg-accent hover:bg-accent/80 text-white rounded-lg text-sm font-medium transition flex items-center justify-center gap-2 mx-auto disabled:opacity-50">
                      {setupBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
                      Generate SSH Key
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Step 3: Verify Connection */}
          <div className={`mb-4 bg-surface border rounded-control overflow-hidden transition-all
            ${setupStep === 3 ? 'border-accent/30' : 'border-line opacity-50'}`}>
            <div className="flex items-center gap-3 px-5 py-4 cursor-pointer" onClick={() => setupStep >= 3 && setSetupStep(3)}>
              <div className={`w-10 h-10 rounded-control flex items-center justify-center
                ${ghStatus.github.connected ? 'bg-emerald-500/10 text-emerald-400' : setupStep === 3 ? 'bg-accent/10 text-accent' : 'bg-raised text-subtle'}`}>
                <Wifi className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h3 className="text-white font-semibold text-sm">Verify Connection</h3>
                <p className="text-subtle text-xs">Test SSH connection to GitHub</p>
              </div>
              {ghStatus.github.connected && <CheckCircle className="w-5 h-5 text-emerald-400" />}
            </div>
            {setupStep === 3 && (
              <div className="px-5 pb-5 border-t border-line pt-4">
                {testResult?.connected || ghStatus.github.connected ? (
                  <div className="text-center py-6">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-card bg-emerald-500/10 border border-emerald-500/20 mb-4">
                      <CheckCircle className="w-8 h-8 text-emerald-400" />
                    </div>
                    <p className="text-white font-semibold mb-1">Connected to GitHub!</p>
                    <p className="text-muted text-sm mb-6">Authenticated as <span className="text-accent font-semibold">@{testResult?.username || ghStatus.github.username}</span></p>
                    <button onClick={checkGHStatus}
                      className="px-6 py-2.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded-lg text-sm font-medium transition flex items-center justify-center gap-2 mx-auto">
                      <ArrowRight className="w-4 h-4" /> Continue to Git Sync
                    </button>
                  </div>
                ) : testResult && !testResult.connected ? (
                  <div className="text-center py-6">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-card bg-red-500/10 border border-red-500/20 mb-4">
                      <XCircle className="w-8 h-8 text-red-400" />
                    </div>
                    <p className="text-white font-semibold mb-1">Connection Failed</p>
                    <p className="text-muted text-sm mb-2">Make sure you've added your SSH key to GitHub</p>
                    {testResult.error && (
                      <pre className="bg-canvas rounded-lg p-2 text-xs text-red-400/70 font-mono mb-4 max-h-20 overflow-auto text-left">{testResult.error}</pre>
                    )}
                    <div className="flex gap-2 justify-center">
                      <button onClick={testConnection} disabled={setupBusy}
                        className="px-4 py-2 bg-accent/10 hover:bg-accent/20 text-accent text-sm rounded-lg transition flex items-center gap-1.5 border border-accent/20 disabled:opacity-50">
                        {setupBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Try Again
                      </button>
                      <button onClick={() => setSetupStep(2)}
                        className="px-4 py-2 bg-raised hover:bg-raised text-muted text-sm rounded-lg transition">
                        ← Back to Key
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-6">
                    <Wifi className="w-10 h-10 text-subtle mx-auto mb-3" />
                    <p className="text-muted text-sm mb-4">Test your SSH connection to GitHub</p>
                    <button onClick={testConnection} disabled={setupBusy}
                      className="px-6 py-2.5 bg-accent hover:bg-accent/80 text-white rounded-lg text-sm font-medium transition flex items-center justify-center gap-2 mx-auto disabled:opacity-50">
                      {setupBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
                      Test Connection
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ──────────────────────────────────────────
  //  NORMAL GIT SYNC VIEW (GitHub connected)
  // ──────────────────────────────────────────
  return (
    <div className="h-full flex flex-col lg:flex-row gap-3 p-3 lg:p-4 overflow-hidden">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-[100] px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg
          ${toast.type === 'success' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
            toast.type === 'error' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
            'bg-blue-500/20 text-blue-400 border border-blue-500/30'}`}>
          {toast.msg}
        </div>
      )}

      {/* Diff Modal */}
      {diffModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setDiffModal(null)}>
          <div className="bg-surface border border-line rounded-t-xl sm:rounded-control w-full sm:max-w-3xl max-h-[85vh] sm:max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-line">
              <span className="text-sm font-medium text-white">{diffModal.file}</span>
              <button onClick={() => setDiffModal(null)} className="text-muted hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <pre className="flex-1 overflow-auto p-4 text-xs font-mono text-ink whitespace-pre">{diffModal.diff}</pre>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {settingsOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setSettingsOpen(false)}>
          <div className="bg-surface border border-line rounded-t-xl sm:rounded-control w-full sm:max-w-lg max-h-[90vh] sm:max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-line">
              <h2 className="text-white font-semibold text-base flex items-center gap-2"><Settings className="w-4 h-4 text-accent" /> GitHub Settings</h2>
              <button onClick={() => setSettingsOpen(false)} className="text-muted hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {/* Identity */}
              <div>
                <h3 className="text-white text-sm font-semibold mb-3 flex items-center gap-2"><User className="w-4 h-4 text-accent" /> Git Identity</h3>
                <div className="space-y-2">
                  <input value={setupName} onChange={e => setSetupName(e.target.value)} placeholder="Name"
                    className="w-full bg-canvas border border-line rounded-lg px-3 py-2 text-sm text-white placeholder-dark-500 focus:border-accent outline-none" />
                  <input value={setupEmail} onChange={e => setSetupEmail(e.target.value)} placeholder="Email"
                    className="w-full bg-canvas border border-line rounded-lg px-3 py-2 text-sm text-white placeholder-dark-500 focus:border-accent outline-none" />
                  <button onClick={async () => {
                    const r = await api('/github/setup', { method: 'POST', body: JSON.stringify({ name: setupName.trim(), email: setupEmail.trim() }) });
                    if (r.success) showToast('Updated!', 'success'); else showToast('Failed: ' + r.error, 'error');
                  }} className="px-3 py-2 bg-accent/10 hover:bg-accent/20 text-accent text-xs rounded-lg transition flex items-center gap-1.5 border border-accent/20">
                    <Save className="w-3.5 h-3.5" /> Update
                  </button>
                </div>
              </div>

              {/* SSH Key */}
              <div className="border-t border-line pt-4">
                <h3 className="text-white text-sm font-semibold mb-3 flex items-center gap-2"><Key className="w-4 h-4 text-accent" /> SSH Public Key</h3>
                <div className="bg-canvas border border-line rounded-lg p-3 font-mono text-xs text-muted break-all max-h-20 overflow-y-auto mb-2">
                  {sshPublicKey || 'Loading...'}
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button onClick={copyKey} className="px-3 py-1.5 bg-raised hover:bg-raised text-ink text-xs rounded-lg transition flex items-center gap-1.5">
                    <Copy className="w-3.5 h-3.5" /> Copy
                  </button>
                  <button onClick={testConnection} disabled={setupBusy}
                    className="px-3 py-1.5 bg-accent/10 hover:bg-accent/20 text-accent text-xs rounded-lg transition flex items-center gap-1.5 border border-accent/20 disabled:opacity-50">
                    {setupBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wifi className="w-3.5 h-3.5" />} Test
                  </button>
                </div>
              </div>

              {/* Clone */}
              <div className="border-t border-line pt-4">
                <h3 className="text-white text-sm font-semibold mb-3 flex items-center gap-2"><DownloadCloud className="w-4 h-4 text-accent" /> Clone Repository</h3>
                <div className="space-y-2">
                  <input value={cloneUrl} onChange={e => setCloneUrl(e.target.value)} placeholder="git@github.com:user/repo.git"
                    className="w-full bg-canvas border border-line rounded-lg px-3 py-2 text-sm text-white placeholder-dark-500 focus:border-accent outline-none" />
                  <input value={clonePath} onChange={e => setClonePath(e.target.value)} placeholder="/root/my-project"
                    className="w-full bg-canvas border border-line rounded-lg px-3 py-2 text-sm text-white placeholder-dark-500 focus:border-accent outline-none" />
                  <div className="bg-canvas/50 border border-line rounded-lg p-2">
                    <p className="text-[11px] text-subtle flex items-start gap-1.5">
                      <Info className="w-3 h-3 shrink-0 mt-0.5" />
                      Auto-sync will be DISABLED after clone. Enable it manually in the Sync Settings tab after verifying the connection.
                    </p>
                  </div>
                  <button onClick={cloneRepo} disabled={cloneBusy}
                    className="px-3 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs rounded-lg transition flex items-center gap-1.5 border border-emerald-500/20 disabled:opacity-50">
                    {cloneBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <DownloadCloud className="w-3.5 h-3.5" />} Clone
                  </button>
                </div>
              </div>

              {/* Danger zone */}
              <div className="border-t border-red-500/20 pt-4">
                <h3 className="text-red-400 text-sm font-semibold mb-3 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Danger Zone</h3>
                <button onClick={disconnect}
                  className="px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs rounded-lg transition flex items-center gap-1.5 border border-red-500/20">
                  <Unlink className="w-3.5 h-3.5" /> Disconnect GitHub
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <div className={`${mobileShowSidebar ? 'flex' : 'hidden'} lg:flex w-full lg:w-72 flex-shrink-0 bg-surface border border-line rounded-control flex-col overflow-hidden ${mobileShowSidebar && selected ? 'max-h-[50vh] lg:max-h-none' : ''}`}>
        {/* GitHub status bar */}
        {ghStatus && ghStatus.github.connected && (
          <div className="px-4 py-3 border-b border-line flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-ink truncate">Connected to GitHub</p>
              <p className="text-[11px] text-subtle truncate">@{ghStatus.github.username || 'unknown'}</p>
            </div>
            <button onClick={() => setSettingsOpen(true)} className="text-muted hover:text-white transition p-1" title="Settings">
              <Settings className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <div className="flex items-center gap-2 text-muted text-sm font-medium"><FolderGit2 className="w-4 h-4" /> Repositories</div>
          <button onClick={loadRepos} className="text-muted hover:text-white transition"><RefreshCw className="w-3.5 h-3.5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {repos.map(r => {
            const syncing = syncConfigs[r.path]?.enabled;
            return (
              <button key={r.path} onClick={() => selectRepo(r.path)}
                className={`w-full text-left px-3 py-2.5 rounded-lg transition-all text-sm
                  ${selected === r.path ? 'bg-accent/10 border border-accent/20 text-white' : 'text-muted hover:bg-raised border border-transparent'}`}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="font-medium flex items-center gap-1.5"><GitBranch className="w-3.5 h-3.5" />{r.path.split('/').pop()}</span>
                  {<span onClick={async (e) => { e.stopPropagation(); const newConf = { ...(syncConfigs[r.path] || defaultSync), enabled: !syncing }; const res = await api('/sync/config', { method: 'POST', body: JSON.stringify({ repo: r.path, ...newConf }) }); if (!res.error) { showToast(newConf.enabled ? 'Sync enabled' : 'Sync disabled', 'success'); loadRepos(); if (selected === r.path) setSyncConf(newConf); } }}
                    className={`text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-1 cursor-pointer transition-all ${syncing ? 'text-emerald-400 bg-emerald-400/10 hover:bg-red-400/10 hover:text-red-400' : 'text-subtle bg-raised hover:bg-emerald-400/10 hover:text-emerald-400'}`}>
                    {syncing ? <><RefreshCw className="w-2.5 h-2.5 animate-spin" />sync</> : 'off'}</span>}
                </div>
                <div className="flex justify-between text-[11px] text-subtle">
                  <span className="truncate max-w-[140px]">{r.path}</span>
                  <span className="text-accent font-mono">{r.branch}</span>
                </div>
              </button>
            );
          })}
          {repos.length === 0 && (
            <div className="empty py-10">
              <GitBranch className="w-7 h-7 text-muted mb-1" />
              <p className="empty-title">No repositories</p>
              <p className="empty-sub text-meta">
                Connect a GitHub account or add a repo on disk to start syncing.
              </p>
            </div>
          )}
        </div>
        <div className="px-4 py-3 border-t border-line">
          <div className="flex items-center gap-2 text-subtle text-[11px] mb-1"><Activity className="w-3 h-3" /> Sync Daemon</div>
          {(() => { const activeCount = Object.values(syncConfigs).filter(c => c.enabled).length;
            return syncStatus.running ? (
              <span className={`text-[11px] ${activeCount > 0 ? 'text-emerald-400' : 'text-muted'}`}>
                ● {activeCount > 0 ? `Syncing ${activeCount} repo${activeCount > 1 ? 's' : ''}` : 'Idle (no repos enabled)'}
              </span>
            ) : <span className="text-[11px] text-red-400">● Stopped</span>;
          })()}
        </div>
      </div>

      {/* Main */}
      <div className={`flex-1 flex flex-col min-w-0 overflow-hidden ${!mobileShowSidebar ? 'flex' : 'hidden lg:flex'}`}>
        {!selected ? (
          <div className="flex-1 empty">
            <GitBranch className="w-9 h-9 text-muted mb-1" />
            <p className="empty-title">{repos.length === 0 ? 'Nothing to sync yet' : 'Select a repository'}</p>
            <p className="empty-sub">
              {repos.length === 0
                ? 'Add a repository on the left, then pick it here to view status, commits and sync settings.'
                : 'Pick a repository from the list to view its status, commits and sync settings.'}
            </p>
          </div>
        ) : (
          <>
            {/* Info bar */}
            <div className="bg-surface border border-line rounded-control px-4 py-3 mb-3">
              <div className="flex items-center gap-2 mb-1">
                <button onClick={() => setMobileShowSidebar(true)} className="lg:hidden text-muted hover:text-white transition">
                  <span className="text-xs">← Repos</span>
                </button>
                <h2 className="text-white font-semibold text-sm">{selected.split('/').pop()}</h2>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <span className="flex items-center gap-1 text-accent font-mono"><GitBranch className="w-3 h-3" />{branch}</span>
                {ahead > 0 && <span className="text-emerald-400">↑ {ahead} ahead</span>}
                {behind > 0 && <span className="text-amber-400">↓ {behind} behind</span>}
                {ahead === 0 && behind === 0 && <span className="text-emerald-400">✓ In sync</span>}
              </div>
            </div>

            {/* Tabs */}
            <div className="flex bg-surface border border-line rounded-control overflow-hidden mb-3">
              {(['changes', 'log', 'branches', 'tags', 'sync'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className={`flex-1 py-2.5 text-xs font-medium transition-all
                    ${tab === t ? 'bg-accent/10 text-accent' : 'text-muted hover:text-white hover:bg-raised'}`}>
                  {t === 'changes' ? 'Changes' : t === 'log' ? 'History' : t === 'branches' ? 'Branches' : t === 'tags' ? 'Tags' : 'Auto-Sync'}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-hidden flex flex-col">
              {tab === 'changes' && (
                <>
                  <div className="flex gap-2 mb-3 flex-wrap">
                    <button onClick={stageAll} className="px-3 py-1.5 bg-raised hover:bg-raised text-ink text-xs rounded-lg transition flex items-center gap-1.5"><GitCommitHorizontal className="w-3.5 h-3.5" /> Stage All</button>
                    <button onClick={pull} className="px-3 py-1.5 bg-accent/10 hover:bg-accent/20 text-accent text-xs rounded-lg transition flex items-center gap-1.5 border border-accent/20"><Download className="w-3.5 h-3.5" /> Pull</button>
                    <button onClick={push} className="px-3 py-1.5 bg-accent/10 hover:bg-accent/20 text-accent text-xs rounded-lg transition flex items-center gap-1.5 border border-accent/20"><Upload className="w-3.5 h-3.5" /> Push</button>
                  </div>
                  <div className="flex-1 bg-surface border border-line rounded-control overflow-y-auto">
                    {changes.length === 0 ? (
                      <div className="text-subtle text-sm text-center py-12">Working tree clean ✨</div>
                    ) : changes.map((f, i) => (
                      <div key={i} className="flex items-center gap-3 px-4 py-2.5 border-b border-line last:border-0 text-sm">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${statusColor(f.status)}`}>{statusLabel(f.status)}</span>
                        <span className="flex-1 font-mono text-xs text-ink truncate">{f.file}</span>
                        <button onClick={() => viewDiff(f.file)} className="text-muted hover:text-accent transition"><Eye className="w-3.5 h-3.5" /></button>
                        <button onClick={() => discardFile(f.file)} className="text-muted hover:text-red-400 transition"><Undo2 className="w-3.5 h-3.5" /></button>
                      </div>
                    ))}
                  </div>
                  {changes.length > 0 && (
                    <div className="flex gap-2 mt-4">
                      <button onClick={handleStash} className="px-3 py-2 bg-raised hover:bg-raised text-white text-sm rounded-lg transition flex items-center gap-2">
                        <Archive className="w-4 h-4" /> Stash Changes
                      </button>
                      <button onClick={handleUnstash} className="px-3 py-2 bg-raised hover:bg-raised text-white text-sm rounded-lg transition flex items-center gap-2">
                        <ArchiveRestore className="w-4 h-4" /> Unstash
                      </button>
                    </div>
                  )}
                  <div className="flex flex-col sm:flex-row gap-2 mt-3">
                    <input value={commitMsg} onChange={e => setCommitMsg(e.target.value)} placeholder="Commit message..."
                      onKeyDown={e => e.key === 'Enter' && commitAndPush()}
                      className="flex-1 bg-surface border border-line rounded-lg px-3 py-2 text-sm text-white placeholder-dark-500 focus:border-accent outline-none" />
                    <button onClick={commitAndPush} disabled={loading}
                      className="px-4 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded-lg text-sm font-medium transition flex items-center justify-center gap-1.5 disabled:opacity-50">
                      <GitCommitHorizontal className="w-4 h-4" /> {loading ? '...' : 'Commit & Push'}
                    </button>
                  </div>
                </>
              )}

              {tab === 'log' && (
                <div className="flex-1 bg-surface border border-line rounded-control overflow-y-auto">
                  {commits.map((c, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-2.5 border-b border-line last:border-0 text-sm">
                      <span className="text-accent bg-accent/10 px-2 py-0.5 rounded text-[11px] font-mono flex-shrink-0">{c.hash?.substring(0, 7)}</span>
                      <span className="flex-1 text-ink text-xs truncate">{c.message}</span>
                      <span className="text-subtle text-[11px] flex-shrink-0">{c.author} · {c.time}</span>
                    </div>
                  ))}
                  {commits.length === 0 && <div className="text-subtle text-sm text-center py-12">No commits</div>}
                </div>
              )}

              {tab === 'branches' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-white font-semibold text-sm">Branches</h3>
                    <button onClick={() => setCreateBranchModal(true)} className="px-3 py-2 bg-accent/10 hover:bg-accent/20 text-accent text-sm rounded-lg transition flex items-center gap-1.5">
                      <GitBranchPlus className="w-4 h-4" /> New Branch
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    {branches.map(b => (
                      <div key={b.name} className="flex items-center justify-between p-3 bg-surface border border-line rounded-lg mb-2">
                        <div className="flex items-center gap-2">
                          <GitBranch className={`w-4 h-4 ${b.isCurrent ? 'text-accent' : 'text-subtle'}`} />
                          <span className={`text-sm ${b.isCurrent ? 'text-white font-medium' : 'text-muted'}`}>{b.name}</span>
                          {b.isCurrent && <span className="px-2 py-0.5 bg-accent/20 text-accent text-xs rounded">current</span>}
                        </div>
                        <div className="flex gap-2">
                          {!b.isCurrent && (
                            <button onClick={() => handleSwitchBranch(b.name)} className="text-muted hover:text-white transition" title="Switch branch">
                              <GitCompare className="w-4 h-4" />
                            </button>
                          )}
                          {!b.isCurrent && (
                            <button onClick={() => handleDeleteBranch(b.name)} className="text-red-400 hover:text-red-300 transition" title="Delete branch">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="bg-surface border border-line rounded-control p-4 text-sm space-y-2">
                    <p className="text-muted"><strong className="text-white">Remote:</strong> <span className="font-mono text-xs text-muted">{remoteUrl}</span></p>
                    {lastCommit && (
                      <p className="text-muted"><strong className="text-white">Last commit:</strong>{' '}
                        <span className="text-accent bg-accent/10 px-1.5 py-0.5 rounded text-[11px] font-mono">{lastCommit.hash?.substring(0, 7)}</span>{' '}
                        {lastCommit.message} <span className="text-subtle text-xs">· {lastCommit.author} · {lastCommit.time}</span>
                      </p>
                    )}
                  </div>
                </div>
              )}

              {tab === 'tags' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-white font-semibold text-sm">Tags</h3>
                    <button onClick={() => setCreateTagModal(true)} className="px-3 py-2 bg-accent/10 hover:bg-accent/20 text-accent text-sm rounded-lg transition flex items-center gap-1.5">
                      <Tag className="w-4 h-4" /> New Tag
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    {tags.length === 0 ? (
                      <div className="text-subtle text-sm text-center py-12">No tags yet</div>
                    ) : (
                      tags.map(tag => (
                        <div key={tag.name} className="flex items-center justify-between p-3 bg-surface border border-line rounded-lg mb-2">
                          <div>
                            <span className="text-white font-medium">{tag.name}</span>
                            {tag.message && <p className="text-xs text-subtle mt-1">{tag.message}</p>}
                          </div>
                          <button onClick={() => handleDeleteTag(tag.name)} className="text-red-400 hover:text-red-300 transition" title="Delete tag">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {tab === 'sync' && (
                <div className="space-y-3 overflow-y-auto">
                  <div className="bg-surface border border-line rounded-control p-4 space-y-4">
                    <h3 className="text-white text-sm font-semibold flex items-center gap-2"><RefreshCw className="w-4 h-4 text-accent" /> Auto-Sync Settings</h3>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" checked={syncConf.enabled} onChange={e => { const newConf = { ...syncConf, enabled: e.target.checked }; setSyncConf(newConf); saveSyncSettings(newConf); }} className="w-4 h-4 accent-accent rounded" />
                      <span className="text-sm text-ink">Enable Auto-Sync</span>
                    </label>
                    <div>
                      <label className="text-xs text-muted mb-1 block">Pull interval (seconds)</label>
                      <input type="number" value={syncConf.intervalSeconds} onChange={e => setSyncConf({ ...syncConf, intervalSeconds: parseInt(e.target.value) || 30 })}
                        className="bg-canvas border border-line rounded-lg px-3 py-2 text-sm text-white w-32 outline-none focus:border-accent" min={10} max={3600} />
                    </div>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" checked={syncConf.autoPush} onChange={e => setSyncConf({ ...syncConf, autoPush: e.target.checked })} className="w-4 h-4 accent-accent rounded" />
                      <span className="text-sm text-ink">Auto Push on file change</span>
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" checked={syncConf.autoPull} onChange={e => setSyncConf({ ...syncConf, autoPull: e.target.checked })} className="w-4 h-4 accent-accent rounded" />
                      <span className="text-sm text-ink">Auto Pull (periodic)</span>
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" checked={syncConf.autoResolveConflicts} onChange={e => setSyncConf({ ...syncConf, autoResolveConflicts: e.target.checked })} className="w-4 h-4 accent-accent rounded" />
                      <span className="text-sm text-ink">Auto-resolve conflicts (keep local)</span>
                    </label>
                    <div>
                      <label className="text-xs text-muted mb-1 block">Commit message template</label>
                      <input type="text" value={syncConf.commitMessage} onChange={e => setSyncConf({ ...syncConf, commitMessage: e.target.value })}
                        className="bg-canvas border border-line rounded-lg px-3 py-2 text-sm text-white w-full outline-none focus:border-accent" />
                    </div>
                    <div>
                      <label className="text-xs text-muted mb-1 block">Restart PM2 App on Pull</label>
                      <select value={syncConf.pm2App || ''} onChange={e => setSyncConf({ ...syncConf, pm2App: e.target.value })}
                        className="bg-canvas border border-line rounded-lg px-3 py-2 text-sm text-white w-full outline-none focus:border-accent">
                        <option value="">None</option>
                        {pm2Apps.map(name => <option key={name} value={name}>{name}</option>)}
                      </select>
                      <p className="text-[10px] text-subtle mt-1">Auto-restart this PM2 app when new code is pulled</p>
                    </div>
                    <button onClick={() => saveSyncSettings()}
                      className="px-4 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded-lg text-sm font-medium transition flex items-center gap-1.5">
                      <Save className="w-4 h-4" /> Save Settings
                    </button>
                  </div>
                  <div className="bg-surface border border-line rounded-control p-4">
                    <h4 className="text-muted text-xs font-medium mb-2">Sync Log</h4>
                    <pre className="bg-canvas rounded-lg p-3 text-[11px] font-mono text-muted max-h-48 overflow-auto whitespace-pre-wrap">{syncStatus.logs || 'No logs yet'}</pre>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Create Branch Modal */}
      {createBranchModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setCreateBranchModal(false)}>
          <div className="bg-surface border border-line rounded-control p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h2 className="text-white font-semibold mb-4">Create New Branch</h2>
            <input value={newBranchName} onChange={e => setNewBranchName(e.target.value)} placeholder="branch-name"
              className="w-full bg-canvas border border-line rounded-lg px-4 py-2.5 text-sm text-white placeholder-dark-500 focus:border-accent outline-none mb-4" />
            <div className="flex gap-2">
              <button onClick={() => setCreateBranchModal(false)} className="flex-1 px-4 py-2 bg-raised hover:bg-raised text-white text-sm rounded-lg transition">Cancel</button>
              <button onClick={handleCreateBranch} className="flex-1 px-4 py-2 bg-accent hover:bg-accent/80 text-white text-sm rounded-lg transition">Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Create Tag Modal */}
      {createTagModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setCreateTagModal(false)}>
          <div className="bg-surface border border-line rounded-control p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h2 className="text-white font-semibold mb-4">Create Tag</h2>
            <input value={newTagName} onChange={e => setNewTagName(e.target.value)} placeholder="v1.0.0"
              className="w-full bg-canvas border border-line rounded-lg px-4 py-2.5 text-sm text-white placeholder-dark-500 focus:border-accent outline-none mb-3" />
            <textarea value={newTagMessage} onChange={e => setNewTagMessage(e.target.value)} placeholder="Release notes..."
              className="w-full bg-canvas border border-line rounded-lg px-4 py-2.5 text-sm text-white placeholder-dark-500 focus:border-accent outline-none mb-4 h-20 resize-none" />
            <div className="flex gap-2">
              <button onClick={() => setCreateTagModal(false)} className="flex-1 px-4 py-2 bg-raised hover:bg-raised text-white text-sm rounded-lg transition">Cancel</button>
              <button onClick={handleCreateTag} className="flex-1 px-4 py-2 bg-accent hover:bg-accent/80 text-white text-sm rounded-lg transition">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
