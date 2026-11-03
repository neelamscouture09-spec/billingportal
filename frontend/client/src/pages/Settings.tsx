import { useEffect, useState } from "react";
import { Check, Settings2, Store } from "lucide-react";
import { toast } from "sonner";
import RetailLayout from "@/components/RetailLayout";
import { retailStore, useRetailState } from "@/lib/retailStore";
import type { RetailSettings } from "@/lib/retailTypes";

export default function Settings() {
  const settings = useRetailState().settings;
  const [form, setForm] = useState<RetailSettings>(settings);
  useEffect(() => { setForm(settings); }, [settings]);
  function save(event: React.FormEvent) {
    event.preventDefault();
    try { retailStore.updateSettings(form); toast.success("Store settings saved in this browser"); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not save store settings"); }
  }
  return <RetailLayout><div className="page-heading"><div><div className="eyebrow">PREFERENCES</div><h1>Settings</h1><p>Set the store identity shown on receipts and across this browser.</p></div></div><section className="panel form-panel settings-panel"><div className="settings-intro"><div className="section-icon"><Store size={18} /></div><div><h2>Store information</h2><p>These details appear in the application header and printed receipts.</p></div></div><form onSubmit={save}><div className="form-grid"><label className="field span-all"><span>STORE NAME</span><input required maxLength={180} value={form.storeName} onChange={(event) => setForm({ ...form, storeName: event.target.value })} /></label><label className="field span-all"><span>STORE ADDRESS</span><textarea rows={3} maxLength={2000} value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} placeholder="Address printed on customer receipts" /></label><label className="field"><span>PHONE</span><input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="Store phone" /></label><label className="field"><span>EMAIL</span><input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="Store email" /></label></div><div className="form-actions"><button type="submit" className="btn-primary"><Check size={14} /> Save settings</button></div></form></section><section className="settings-note"><Settings2 size={15} /><p><strong>Browser-only data</strong><span>Store settings and business records stay in this browser profile; they are not sent to a server or payment provider.</span></p></section></RetailLayout>;
}
