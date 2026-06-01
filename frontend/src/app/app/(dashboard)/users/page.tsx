"use client";

import { useEffect, useState } from "react";
import { Trash2, UserPlus, Users as UsersIcon } from "lucide-react";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";
import { PageHeader, EmptyState, DataTable, type Column } from "@/components/ui";

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("viewer");
  const [error, setError] = useState("");

  function load() {
    api.users().then(setUsers).finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.createUser(email, password, role);
      setEmail("");
      setPassword("");
      setRole("viewer");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this user?")) return;
    try {
      await api.deleteUser(id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    }
  }

  const columns: Column<User>[] = [
    { key: "email", header: "Email", className: "text-white", render: (u) => u.email },
    { key: "role", header: "Role", className: "capitalize", render: (u) => u.role },
    { key: "is_active", header: "Active", render: (u) => (u.is_active ? "Yes" : "No") },
    {
      key: "created_at",
      header: "Created",
      className: "text-muted",
      render: (u) => new Date(u.created_at).toLocaleDateString(),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (u) => (
        <button
          onClick={() => remove(u.id)}
          className="text-muted hover:text-live"
          aria-label="delete user"
        >
          <Trash2 size={16} />
        </button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Users" subtitle="Manage admin dashboard access (admin only)" />

      <form onSubmit={create} className="card p-5 mb-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="text-sm text-muted">Email</label>
          <input
            className="input mt-1"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="text-sm text-muted">Password (min 8)</label>
          <input
            className="input mt-1"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="text-sm text-muted">Role</label>
          <select className="input mt-1 w-36" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button className="btn-primary">
          <UserPlus size={15} /> Add user
        </button>
      </form>

      {error && (
        <div className="rounded-lg bg-live/15 text-live text-sm px-3 py-2 mb-4">{error}</div>
      )}

      <div className="card overflow-hidden">
        <DataTable
          columns={columns}
          rows={users}
          rowKey={(u) => u.id}
          loading={loading}
          empty={
            <EmptyState
              icon={<UsersIcon size={20} />}
              title="No users"
              message="No admin users yet. Add one with the form above."
            />
          }
        />
      </div>
    </div>
  );
}
