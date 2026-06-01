"use client";

import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { portal, clearCustomerToken } from "@/lib/portal";
import type { MeResponse } from "@/lib/portal";
import { PageHeader, Spinner } from "@/components/ui";

export default function PortalSettingsPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");

  const [threshold, setThreshold] = useState(80);
  const [savingThreshold, setSavingThreshold] = useState(false);

  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    portal
      .me()
      .then((m) => {
        setMe(m);
        setName(m.customer.name ?? "");
        setThreshold(m.customer.alert_threshold ?? 80);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "failed"))
      .finally(() => setLoading(false));
  }, []);

  async function saveName() {
    setSavingName(true);
    setSuccess("");
    setError("");
    try {
      await portal.updateAccount({ name });
      setSuccess("Display name updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    } finally {
      setSavingName(false);
    }
  }

  async function changePassword() {
    setPasswordError("");
    if (newPassword.length < 8) {
      setPasswordError("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match.");
      return;
    }
    setSavingPassword(true);
    setSuccess("");
    setError("");
    try {
      await portal.updateAccount({ password: newPassword });
      setNewPassword("");
      setConfirmPassword("");
      setSuccess("Password changed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    } finally {
      setSavingPassword(false);
    }
  }

  async function saveThreshold() {
    setSavingThreshold(true);
    setSuccess("");
    setError("");
    try {
      await portal.updateAccount({ alert_threshold: threshold });
      setSuccess("Usage alert threshold updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    } finally {
      setSavingThreshold(false);
    }
  }

  function signOut() {
    clearCustomerToken();
    window.location.href = "/login";
  }

  if (loading || !me) return <Spinner />;

  return (
    <div>
      <PageHeader title="Settings" subtitle="Manage your ZeroApi account" />

      {success && (
        <div className="card px-4 py-3 mb-4 text-sm text-white">{success}</div>
      )}
      {error && (
        <div className="rounded-lg bg-live/15 text-live text-sm px-3 py-2 mb-4">
          {error}
        </div>
      )}

      <div className="card p-5 mb-6">
        <h2 className="font-semibold text-white mb-4">Profile</h2>

        <div className="mb-5">
          <label className="block text-sm text-white font-medium mb-1">Email</label>
          <p className="text-sm text-muted">{me.customer.email}</p>
          <p className="text-xs text-muted mt-1">Email cannot be changed</p>
        </div>

        <div className="mb-5">
          <label className="block text-sm text-white font-medium mb-2">Plan</label>
          <span className="badge bg-brand/15 text-brand">{me.plan.name}</span>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[260px]">
            <label className="block text-sm text-white font-medium mb-2">
              Display name
            </label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <button
            onClick={saveName}
            disabled={savingName || name === me.customer.name}
            className="btn-primary"
          >
            <Save size={15} /> {savingName ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <div className="card p-5 mb-6">
        <h2 className="font-semibold text-white mb-4">Password</h2>

        <div className="mb-4">
          <label className="block text-sm text-white font-medium mb-2">
            New password
          </label>
          <input
            type="password"
            className="input"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm text-white font-medium mb-2">
            Confirm password
          </label>
          <input
            type="password"
            className="input"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>

        {passwordError && (
          <p className="text-sm text-live mb-4">{passwordError}</p>
        )}

        <button
          onClick={changePassword}
          disabled={savingPassword}
          className="btn-primary"
        >
          {savingPassword ? "Saving…" : "Change password"}
        </button>
      </div>

      <div className="card p-5 mb-6">
        <h2 className="font-semibold text-white mb-1">Usage alerts</h2>
        <p className="text-sm text-muted mb-4">
          Show a warning banner when you cross this percentage of your monthly quota.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[260px]">
            <label className="block text-sm text-white font-medium mb-2">
              Alert at {threshold}% of quota
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="w-full accent-brand"
            />
          </div>
          <button
            onClick={saveThreshold}
            disabled={savingThreshold || threshold === me.customer.alert_threshold}
            className="btn-primary"
          >
            <Save size={15} /> {savingThreshold ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="font-semibold text-white mb-1">Danger zone</h2>
        <p className="text-sm text-muted mb-4">
          Sign out of your ZeroApi account on this device.
        </p>
        <button onClick={signOut} className="btn-ghost">
          Sign out
        </button>
      </div>
    </div>
  );
}
