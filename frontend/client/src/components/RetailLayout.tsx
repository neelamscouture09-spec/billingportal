import { useState } from "react";
import { Link, useLocation } from "wouter";
import { AlertTriangle, BarChart3, Bell, Boxes, ChevronRight, Command, CreditCard, Menu, Package, Plus, Search, Settings2, Shirt, Store, Truck, X } from "lucide-react";
import { retailStore, useRetailState } from "@/lib/retailStore";

const navigation = [
  { href: "/", label: "POS / Billing", icon: CreditCard },
  { href: "/products", label: "Products", icon: Package },
  { href: "/suppliers", label: "Suppliers", icon: Truck },
  { href: "/returns", label: "Returns", icon: Boxes },
  { href: "/reports", label: "Reports", icon: BarChart3 },
];

export default function RetailLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const currentState = useRetailState();
  const settings = currentState.settings;
  const persistence = retailStore.getPersistenceStatus();
  const section = navigation.find((item) => item.href === location)?.label ?? (location.startsWith("/reports/purchases/") ? "Purchase details" : location === "/settings" ? "Settings" : "POS / Billing");
  const today = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());

  const Sidebar = ({ mobile = false }: { mobile?: boolean }) => (
    <aside className={`retail-sidebar ${mobile ? "retail-sidebar-mobile" : ""}`}>
      <div className="brand-lockup"><div className="brand-mark"><Shirt size={19} strokeWidth={2.2} /><span /></div><div><strong>NEELAMS POS</strong><small>RETAIL DESK</small></div>{mobile && <button className="icon-button sidebar-close" aria-label="Close menu" onClick={() => setMobileOpen(false)}><X size={18} /></button>}</div>
      <div className="store-chip"><div className="store-avatar"><Store size={16} /></div><div className="store-copy"><strong>{settings.storeName || "StylePOS Boutique"}</strong><span>Store workspace</span></div><ChevronRight size={15} /></div>
      <span className="sidebar-label">WORKSPACE</span>
      <nav className="side-nav" aria-label="Main navigation">
        {navigation.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? location === "/" : location === href || location.startsWith(`${href}/`);
          return <Link key={href} href={href} onClick={() => setMobileOpen(false)} className={`nav-link ${active ? "active" : ""}`}><Icon size={18} strokeWidth={active ? 2.1 : 1.8} /><span>{label}</span>{href === "/" && active && <span className="nav-dot" />}</Link>;
        })}
      </nav>
      <div className="sidebar-bottom"><div className="sidebar-tip"><div className="tip-icon"><Command size={16} /></div><p><strong>Quick tip</strong><span>Keep your scanner ready to speed through checkout.</span></p></div><Link href="/settings" onClick={() => setMobileOpen(false)} className={`nav-link settings-link ${location === "/settings" ? "active" : ""}`}><Settings2 size={18} /><span>Settings</span></Link><div className={`sidebar-footer ${persistence.persistent ? "" : "storage-warning"}`}><span className="status-dot" /> {persistence.persistent ? "Stored in this browser" : "Storage unavailable"} <span className="footer-version">v1.0</span></div></div>
    </aside>
  );

  return <div className="app-frame"><Sidebar /><div className="workspace"><header className="topbar"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={19} /></button><div className="crumbs"><span>Workspace</span><ChevronRight size={14} /><strong>{section}</strong></div><div className="topbar-tools"><span className="topbar-date">{today}</span><button className="header-search" onClick={() => setLocation("/products")} aria-label="Search products"><Search size={16} /><span>Search anything</span><kbd>⌘ K</kbd></button><button className="icon-button notification-button" aria-label="Notifications"><Bell size={18} /><i /></button><button className="primary-button quick-bill" onClick={() => setLocation("/")}><Plus size={16} /> Quick new bill</button></div></header>{!persistence.persistent && <div className="storage-warning-banner" role="alert"><AlertTriangle size={16} /><span>{persistence.message ?? "Browser storage is unavailable. Changes may not survive a page reload."}</span></div>}<main className="page-content">{children}</main></div>{mobileOpen && <div className="mobile-overlay" onClick={() => setMobileOpen(false)}><div onClick={(event) => event.stopPropagation()}><Sidebar mobile /></div></div>}</div>;
}
