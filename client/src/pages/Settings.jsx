import { useEffect, useState } from 'react'; import { api, useApi, errMsg } from '../api.js'; import { Card, Btn, Skeleton, ErrorBox, useToast } from '../ui.jsx';
export default function Settings() {
  const { data, loading, error, reload } = useApi('/settings'); const [tol, setTol] = useState(24); const toast = useToast(); useEffect(() => { if (data) setTol(data.toleranceHours); }, [data]);
  const save = async () => { try { await api.patch('/settings', { currency: 'INR', toleranceHours: Number(tol) }); toast('Settings saved'); reload(); } catch (e) { toast(errMsg(e), true); } };
  if (loading) return <Skeleton />; if (error) return <ErrorBox msg={error} retry={reload} />;
  return <div className="space-y-4 max-w-xl"><h1 className="text-xl font-semibold">Settings</h1><Card title="Global defaults (applied to new runs)"><label className="block text-sm mb-3">Default currency<input disabled value="INR" className="block border rounded px-2 py-1 bg-slate-100 mt-1" /></label><label className="block text-sm mb-3">Matching timestamp tolerance (hours)<input type="number" min="0" max="720" value={tol} onChange={(e) => setTol(e.target.value)} className="block border rounded px-2 py-1 mt-1" /></label><Btn onClick={save}>Save</Btn></Card><p className="text-xs text-slate-500">Each run stores the tolerance it used; changing this later never alters past runs.</p></div>;
}
