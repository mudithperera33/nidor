import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, ArrowRight, CircleAlert, LoaderCircle, MailCheck, ShieldCheck } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Form } from '@/components/ui/form';
import AdminProductsDashboard from '@/components/admin-products-dashboard';
import { checkProductAdminAccess, requestAdminSignIn, signOutAdmin } from '@/lib/product-catalog';
import { getSupabaseClient } from '@/lib/supabase';
import { z } from 'zod';
import type { Session } from '@supabase/supabase-js';
import '../admin-products-page.css';

const emailSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
});

type EmailFormValues = z.infer<typeof emailSchema>;

type GateState =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'checking'; email: string }
  | { kind: 'authorized'; email: string }
  | { kind: 'denied'; email: string }
  | { kind: 'error'; message: string };

export default function AdminProductsPage() {
  const [gate, setGate] = useState<GateState>({ kind: 'loading' });
  const [sentTo, setSentTo] = useState('');
  const [signInError, setSignInError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const form = useForm<EmailFormValues>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: '' },
  });

  useEffect(() => {
    document.title = 'NIDOR — Product Administration';
    let active = true;
    let attempt = 0;

    const checkSession = async (session: Session | null) => {
      const currentAttempt = ++attempt;
      if (!session) {
        if (active) setGate({ kind: 'signed-out' });
        return;
      }

      const email = session.user.email ?? '';
      if (active) setGate({ kind: 'checking', email });

      try {
        const allowed = await checkProductAdminAccess();
        if (!active || currentAttempt !== attempt) return;
        setGate(allowed ? { kind: 'authorized', email } : { kind: 'denied', email });
      } catch (error) {
        if (!active || currentAttempt !== attempt) return;
        setGate({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Could not verify product-management access.',
        });
      }
    };

    let client;
    try {
      client = getSupabaseClient();
    } catch (error) {
      setGate({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Supabase is not configured.',
      });
      return () => { active = false; };
    }

    const { data: authListener } = client.auth.onAuthStateChange((_event, session) => {
      window.setTimeout(() => {
        if (active) void checkSession(session);
      }, 0);
    });

    void client.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setGate({ kind: 'error', message: error.message });
        return;
      }
      void checkSession(data.session);
    });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  const submitEmail = form.handleSubmit(async ({ email }) => {
    setSignInError('');
    setSentTo('');
    setIsSending(true);
    try {
      await requestAdminSignIn(email);
      setSentTo(email.trim().toLowerCase());
    } catch (error) {
      setSignInError(error instanceof Error ? error.message : 'The sign-in link could not be sent.');
    } finally {
      setIsSending(false);
    }
  });

  const retrySessionCheck = async () => {
    setGate({ kind: 'loading' });
    try {
      const { data, error } = await getSupabaseClient().auth.getSession();
      if (error) throw error;
      if (!data.session) {
        setGate({ kind: 'signed-out' });
        return;
      }
      const allowed = await checkProductAdminAccess();
      setGate(allowed
        ? { kind: 'authorized', email: data.session.user.email ?? '' }
        : { kind: 'denied', email: data.session.user.email ?? '' });
    } catch (error) {
      setGate({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not verify product-management access.',
      });
    }
  };

  const handleSignOut = () => {
    void signOutAdmin().catch((error: unknown) => {
      setSignInError(error instanceof Error ? error.message : 'Could not sign out.');
    });
  };

  if (gate.kind === 'authorized') {
    return <AdminProductsDashboard userEmail={gate.email} onSignOut={handleSignOut} />;
  }

  if (gate.kind === 'loading' || gate.kind === 'checking') {
    return (
      <main className="nidor-admin-gate" aria-live="polite">
        <div className="nag-card nag-loading">
          <LoaderCircle className="nag-spinner" size={22} />
          <span>{gate.kind === 'checking' ? 'Checking access' : 'Opening the studio'}</span>
        </div>
      </main>
    );
  }

  if (gate.kind === 'error') {
    return (
      <main className="nidor-admin-gate">
        <div className="nag-card">
          <a className="nag-back" href="/" data-testid="link-return-storefront"><ArrowLeft size={15} /> Storefront</a>
          <div className="nag-mark"><CircleAlert size={23} /></div>
          <div className="nag-kicker">NIDOR / PRODUCT OPERATIONS</div>
          <h1>Studio access<br /><em>is unavailable.</em></h1>
          <p className="nag-message" role="alert" data-testid="status-admin-gate-error">{gate.message}</p>
          <button className="nag-primary" type="button" onClick={() => void retrySessionCheck()} data-testid="button-retry-access">
            Try again <ArrowRight size={15} />
          </button>
        </div>
      </main>
    );
  }

  if (gate.kind === 'denied') {
    return (
      <main className="nidor-admin-gate">
        <div className="nag-card">
          <a className="nag-back" href="/" data-testid="link-return-storefront"><ArrowLeft size={15} /> Storefront</a>
          <div className="nag-mark"><ShieldCheck size={23} /></div>
          <div className="nag-kicker">NIDOR / PRODUCT OPERATIONS</div>
          <h1>This account<br /><em>is not on the list.</em></h1>
          <p className="nag-message" role="alert" data-testid="status-admin-denied">
            {gate.email || 'This account'} does not have product-management access.
          </p>
          <button className="nag-primary" type="button" onClick={handleSignOut} data-testid="button-admin-denied-signout">
            Sign out <ArrowRight size={15} />
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="nidor-admin-gate">
      <div className="nag-card">
        <a className="nag-back" href="/" data-testid="link-return-storefront"><ArrowLeft size={15} /> Storefront</a>
        <div className="nag-mark">{sentTo ? <MailCheck size={23} /> : <ShieldCheck size={23} />}</div>
        <div className="nag-kicker">NIDOR / PRODUCT OPERATIONS</div>
        <h1>{sentTo ? <>Check your<br /><em>inbox.</em></> : <>A considered<br /><em>collection.</em></>}</h1>
        {sentTo ? (
          <>
            <p className="nag-message" data-testid="status-sign-in-link-sent">
              A secure sign-in link was sent to <strong>{sentTo}</strong>. Open it on this device to continue.
            </p>
            <button className="nag-text-button" type="button" onClick={() => setSentTo('')} data-testid="button-use-different-email">
              Use a different email
            </button>
          </>
        ) : (
          <>
            <p className="nag-message">
              Sign in with the email address authorized for product management. Access is checked against the protected catalogue.
            </p>
            <Form {...form}>
              <form className="nag-form" onSubmit={submitEmail}>
                <label htmlFor="admin-email">Email address</label>
                <input
                  id="admin-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  {...form.register('email')}
                  aria-invalid={!!form.formState.errors.email}
                  data-testid="input-admin-email"
                />
                {form.formState.errors.email?.message && (
                  <small className="nag-form-error" role="alert">{form.formState.errors.email.message}</small>
                )}
                {signInError && <small className="nag-form-error" role="alert" data-testid="status-admin-signin-error">{signInError}</small>}
                <button className="nag-primary" type="submit" disabled={isSending} data-testid="button-send-signin-link">
                  {isSending ? <LoaderCircle className="nag-spinner" size={16} /> : <MailCheck size={16} />}
                  {isSending ? 'Sending link' : 'Send sign-in link'}
                </button>
              </form>
            </Form>
            <p className="nag-footnote">Only an email approved by the database can manage the collection.</p>
          </>
        )}
      </div>
    </main>
  );
}