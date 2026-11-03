import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Products from "./pages/Products";
import Suppliers from "./pages/Suppliers";
import Returns from "./pages/Returns";
import Reports from "./pages/Reports";
import PurchaseDetails from "./pages/PurchaseDetails";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";
import Trials from "./pages/Trials";

function Router() {
  return <Switch>
    <Route path="/" component={Home} />
    <Route path="/products" component={Products} />
    <Route path="/suppliers" component={Suppliers} />
    <Route path="/returns" component={Returns} />
    <Route path="/reports" component={Reports} />
    <Route path="/reports/purchases/:id" component={PurchaseDetails} />
    <Route path="/settings" component={Settings} />
    <Route path="/trials" component={Trials} />
    <Route path="/404" component={NotFound} />
    <Route component={NotFound} />
  </Switch>;
}

export default function App() {
  return <ErrorBoundary><ThemeProvider defaultTheme="light"><TooltipProvider><Toaster richColors position="top-right" /><Router /></TooltipProvider></ThemeProvider></ErrorBoundary>;
}
