import axios from 'axios'; import { useEffect, useState, useCallback } from 'react';
export const api = axios.create({ baseURL: '/api' });
export const errMsg = (e) => e.response?.data?.error?.details?.join('; ') || e.response?.data?.error?.message || e.message;
export function useApi(url, params) {
  const [s, set] = useState({ data: null, meta: null, loading: true, error: null }); const key = url + JSON.stringify(params);
  const load = useCallback(() => { set((x) => ({ ...x, loading: true, error: null })); api.get(url, { params }).then((r) => set({ data: r.data.data, meta: r.data.meta, loading: false, error: null }), (e) => set({ data: null, meta: null, loading: false, error: errMsg(e) })); }, [key]);
  useEffect(load, [load]); return { ...s, reload: load };
}
export async function download(url, params) { const r = await api.get(url, { params, responseType: 'blob' }); const name = /filename="(.+)"/.exec(r.headers['content-disposition'] || '')?.[1] || 'download'; const a = document.createElement('a'); a.href = URL.createObjectURL(r.data); a.download = name; a.click(); URL.revokeObjectURL(a.href); }
