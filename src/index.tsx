/* @refresh reload */
import { render } from 'solid-js/web';
import { Navigate, Route, Router } from '@solidjs/router';
import { SessionProvider } from './lib/session';
import { Layout } from './components/Layout';
import Login from './routes/Login';
import Repertoire from './routes/Repertoire';
import Practice from './routes/Practice';
import Search from './routes/Search';
import TuneDetail from './routes/TuneDetail';
import About from './routes/About';
import './index.css';

const root = document.getElementById('root');

if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(
    'Root element not found. Did you forget to add it to index.html?'
  );
}

function NotFound() {
  return <Navigate href="/" />;
}

render(
  () => (
    <SessionProvider>
      <Router root={Layout}>
        <Route path="/login" component={Login} />
        <Route path="/" component={Repertoire} />
        <Route path="/practice" component={Practice} />
        <Route path="/search" component={Search} />
        <Route path="/repertoire/:id" component={TuneDetail} />
        <Route path="/about" component={About} />
        <Route path="*" component={NotFound} />
      </Router>
    </SessionProvider>
  ),
  root!
);
