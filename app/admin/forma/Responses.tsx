'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

type Row = {
  id: string; visited_at: string; manager: string; store: string
  took_order: boolean; debt_status: string | null; cash_collected: string | null
  n_present: string; n_stale: string; n_photos: string
}

const when = new Intl.DateTimeFormat('uz-UZ', {
  day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
})
const money = new Intl.NumberFormat('uz-UZ')

/**
 * The responses side of the editor. Individual records and the charts already
 * have their own pages, so this links to them rather than growing a third copy
 * of the same queries — what it adds is the export and the count.
 */
export default function Responses() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    fetch('/api/visits?limit=100')
      .then(async (r) => { if (!r.ok) throw new Error((await r.json()).error); return r.json() })
      .then(setRows)
      .catch((e) => setErr(e.message))
  }, [])

  return (
    <div>
      <div className="row">
        <a className="btn" href="/api/export/csv">CSV yuklab olish</a>
        <Link className="btn btn-ghost" href="/admin/savollar">Savollar bo&apos;yicha xulosa</Link>
        <Link className="btn btn-ghost" href="/admin/hisobot">Hisobot</Link>
      </div>

      {err && <p className="alert err">{err}</p>}
      {!rows ? <p className="empty">Yuklanmoqda…</p> : (
        <>
          <p className="sub">{rows.length} ta oxirgi javob</p>
          <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Do&apos;kon</th><th>Sana</th><th>Menejer</th>
                <th>Buyurtma</th><th>Pul</th><th>Kitob</th><th>Rasm</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td data-label="Do'kon"><Link href={`/vizit/${r.id}`}>{r.store}</Link></td>
                  <td data-label="Sana">{when.format(new Date(r.visited_at))}</td>
                  <td data-label="Menejer">{r.manager}</td>
                  <td data-label="Buyurtma">{r.took_order ? 'ha' : '—'}</td>
                  <td data-label="Pul">{r.cash_collected ? money.format(Number(r.cash_collected)) : '—'}</td>
                  <td data-label="Kitob">{r.n_present} / {r.n_stale}</td>
                  <td data-label="Rasm">{r.n_photos}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {!rows.length && <p className="empty">Hali javob yo&apos;q</p>}
        </>
      )}
    </div>
  )
}
