import { ChangeEvent, FormEvent, useId, useState } from 'react';
import { ArrowRight, Check, Eye, EyeOff, LoaderCircle, LockKeyhole, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';

type LoginTheme = 'tenant' | 'control';

interface RoleLoginFormProps {
  theme: LoginTheme;
  brandLabel: string;
  heroTitle: string;
  heroDescription: string;
  features: readonly string[];
  accessLabel: string;
  title: string;
  subtitle: string;
  submitLabel: string;
  alternatePrompt: string;
  alternateLabel: string;
  alternatePath: string;
  onLogin: (username: string, password: string) => Promise<void>;
}

const THEMES: Record<LoginTheme, {
  ambient: string;
  badge: string;
  check: string;
  button: string;
  link: string;
}> = {
  tenant: {
    ambient: 'bg-cyan-400/20',
    badge: 'bg-cyan-400 text-slate-950',
    check: 'bg-cyan-400/15 text-cyan-200 ring-cyan-300/20',
    button: 'bg-cyan-600 hover:bg-cyan-500 focus-visible:ring-cyan-500',
    link: 'text-cyan-700 hover:text-cyan-600 focus-visible:ring-cyan-600',
  },
  control: {
    ambient: 'bg-indigo-400/25',
    badge: 'bg-indigo-400 text-slate-950',
    check: 'bg-indigo-400/15 text-indigo-200 ring-indigo-300/20',
    button: 'bg-indigo-600 hover:bg-indigo-500 focus-visible:ring-indigo-500',
    link: 'text-indigo-700 hover:text-indigo-600 focus-visible:ring-indigo-600',
  },
};

function getLoginError(requestError: unknown): string {
  const response = requestError && typeof requestError === 'object'
    ? (requestError as { response?: { data?: { error?: unknown } } }).response
    : undefined;
  return typeof response?.data?.error === 'string'
    ? response.data.error
    : 'Login failed. Please try again.';
}

function RoleLoginForm({
  theme,
  brandLabel,
  heroTitle,
  heroDescription,
  features,
  accessLabel,
  title,
  subtitle,
  submitLabel,
  alternatePrompt,
  alternateLabel,
  alternatePath,
  onLogin,
}: RoleLoginFormProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const usernameId = useId();
  const passwordId = useId();
  const titleId = useId();
  const descriptionId = useId();
  const styles = THEMES[theme];

  const handleUsernameChange = (event: ChangeEvent<HTMLInputElement>) => {
    setUsername(event.target.value);
  };

  const handlePasswordChange = (event: ChangeEvent<HTMLInputElement>) => {
    setPassword(event.target.value);
  };

  const handleTogglePassword = () => {
    setShowPassword((current) => !current);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await onLogin(username.trim(), password);
    } catch (requestError: unknown) {
      setError(getLoginError(requestError));
    } finally {
      setLoading(false);
    }
  };

  const featureItems = features.map((feature) => (
    <li key={feature} className="flex items-center gap-3 text-sm text-slate-200 sm:text-base">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1 ${styles.check}`}>
        <Check aria-hidden="true" size={15} strokeWidth={2.5} />
      </span>
      <span>{feature}</span>
    </li>
  ));

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <div aria-hidden="true" className={`absolute -left-24 top-[-7rem] h-80 w-80 rounded-full blur-3xl ${styles.ambient}`} />
      <div aria-hidden="true" className="absolute -bottom-40 right-[-6rem] h-96 w-96 rounded-full bg-blue-500/10 blur-3xl" />
      <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(148,163,184,0.12),transparent_42%)]" />

      <div className="relative mx-auto grid min-h-screen w-full max-w-7xl items-center gap-10 px-5 py-10 sm:px-8 lg:grid-cols-[1.08fr_0.92fr] lg:gap-16 lg:px-12">
        <section className="max-w-2xl lg:pb-8" aria-labelledby={`${titleId}-hero`}>
          <div className="mb-8 flex items-center gap-3">
            <div className={`flex h-11 w-11 items-center justify-center rounded-2xl font-black tracking-tight shadow-lg ${styles.badge}`}>
              EP
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-300">{brandLabel}</p>
              <p className="mt-0.5 text-xs text-slate-500">Secure assessment operations</p>
            </div>
          </div>

          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">
            <ShieldCheck aria-hidden="true" size={15} /> Role-scoped workspace
          </p>
          <h1 id={`${titleId}-hero`} className="max-w-2xl text-4xl font-black leading-[1.08] tracking-[-0.035em] text-white sm:text-5xl lg:text-6xl">
            {heroTitle}
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            {heroDescription}
          </p>
          <ul className="mt-8 grid gap-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            {featureItems}
          </ul>
        </section>

        <section
          className="mx-auto w-full max-w-lg rounded-[2rem] border border-white/70 bg-white p-6 text-slate-900 shadow-[0_28px_90px_rgba(2,6,23,0.45)] sm:p-9"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
        >
          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">{accessLabel}</p>
              <h2 id={titleId} className="mt-3 text-3xl font-black tracking-[-0.025em] text-slate-950">{title}</h2>
              <p id={descriptionId} className="mt-2 text-sm leading-6 text-slate-600">{subtitle}</p>
            </div>
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 ring-1 ring-slate-200">
              <LockKeyhole aria-hidden="true" size={21} />
            </span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor={usernameId} className="mb-2 block text-sm font-semibold text-slate-800">Username</label>
              <input
                id={usernameId}
                type="text"
                value={username}
                onChange={handleUsernameChange}
                disabled={loading}
                required
                maxLength={100}
                autoComplete="username"
                className="h-12 rounded-xl border-slate-300 bg-slate-50 px-4 text-base shadow-sm placeholder:text-slate-400 focus:bg-white"
                placeholder="Enter your username"
              />
            </div>

            <div>
              <label htmlFor={passwordId} className="mb-2 block text-sm font-semibold text-slate-800">Password</label>
              <div className="relative">
                <input
                  id={passwordId}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={handlePasswordChange}
                  disabled={loading}
                  required
                  maxLength={128}
                  autoComplete="current-password"
                  className="h-12 rounded-xl border-slate-300 bg-slate-50 px-4 pr-12 text-base shadow-sm placeholder:text-slate-400 focus:bg-white"
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  onClick={handleTogglePassword}
                  disabled={loading}
                  className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-slate-500 transition-colors hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-500"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff aria-hidden="true" size={19} /> : <Eye aria-hidden="true" size={19} />}
                </button>
              </div>
            </div>

            {error && (
              <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              className={`flex h-12 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold text-white shadow-lg transition-all focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${styles.button}`}
              disabled={loading}
            >
              {loading ? (
                <>
                  <LoaderCircle aria-hidden="true" className="animate-spin" size={18} />
                  <span>Signing in...</span>
                </>
              ) : (
                <>
                  <span>{submitLabel}</span>
                  <ArrowRight aria-hidden="true" size={18} />
                </>
              )}
            </button>
          </form>

          <div className="mt-8 border-t border-slate-200 pt-6">
            <p className="text-center text-sm text-slate-600">
              {alternatePrompt}{' '}
              <Link
                to={alternatePath}
                className={`rounded font-bold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 ${styles.link}`}
              >
                {alternateLabel}
              </Link>
            </p>
            <p className="mt-4 flex items-center justify-center gap-2 text-xs text-slate-400">
              <ShieldCheck aria-hidden="true" size={14} /> Authentication is enforced by role and tenant scope.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

export default RoleLoginForm;
