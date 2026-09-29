"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Plug, Trash2, Webhook } from "lucide-react";
import { isConfigured } from "@/lib/runtime";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ListSkeleton } from "@/components/list-skeleton";

/**
 * Settings → Integrations: connect Trello, Asana or a webhook. After every
 * meeting with notes, the action items are pushed there automatically.
 */

function message(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : "";
  return raw.split("Uncaught Error: ").pop() || fallback;
}

type Option = { id: string; name: string };

export function IntegrationsTab() {
  const integrations = useQuery(api.integrations.list, isConfigured ? {} : "skip");
  if (!isConfigured) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Integrations come alive once Clerk and Convex keys are added.
        </CardContent>
      </Card>
    );
  }
  if (integrations === undefined) return <ListSkeleton rows={3} />;
  const byProvider = Object.fromEntries(integrations.map((i) => [i.provider, i]));
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Connect a task tool and the AI Note Taker files every action item there when a
        meeting ends — task, owner and deadline included. Keys are encrypted and never shown
        again.
      </p>
      <TrelloCard row={byProvider.trello} />
      <AsanaCard row={byProvider.asana} />
      <WebhookCard row={byProvider.webhook} />
    </div>
  );
}

type Row = NonNullable<ReturnType<typeof useQuery<typeof api.integrations.list>>>[number];

function Header({
  title,
  icon,
  row,
  onDisconnect,
}: {
  title: string;
  icon: React.ReactNode;
  row: Row | undefined;
  onDisconnect: () => void;
}) {
  const setAutoRoute = useMutation(api.integrations.setAutoRoute);
  return (
    <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
      <CardTitle className="flex items-center gap-2 text-base">
        {icon} {title}
        {row && (
          <Badge
            variant="outline"
            className={row.status === "connected" ? "border-emerald-500/40 text-emerald-400" : "border-destructive/40 text-destructive"}
          >
            {row.status === "connected" ? `Connected${row.label ? ` · ${row.label}` : ""}` : "Needs attention"}
          </Badge>
        )}
      </CardTitle>
      {row && (
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch
              checked={row.autoRoute}
              onCheckedChange={async (value) => {
                try {
                  await setAutoRoute({ provider: row.provider, autoRoute: value });
                } catch (e) {
                  toast.error(message(e, "Could not update."));
                }
              }}
            />
            Auto-send after each meeting
          </label>
          <Button variant="ghost" size="sm" onClick={onDisconnect}>
            <Trash2 className="size-4" /> Disconnect
          </Button>
        </div>
      )}
    </CardHeader>
  );
}

function useDisconnect(provider: "trello" | "asana" | "webhook") {
  const disconnect = useMutation(api.integrations.disconnect);
  return async () => {
    try {
      await disconnect({ provider });
      toast.success("Disconnected.");
    } catch (e) {
      toast.error(message(e, "Could not disconnect."));
    }
  };
}

// ── Trello ──────────────────────────────────────────────────────────────

function TrelloCard({ row }: { row: Row | undefined }) {
  const connect = useAction(api.integrations.connectTrello);
  const loadBoards = useAction(api.integrations.trelloBoards);
  const loadLists = useAction(api.integrations.trelloLists);
  const setTarget = useMutation(api.integrations.setTarget);
  const onDisconnect = useDisconnect("trello");
  const [key, setKey] = useState("");
  const [token, setToken] = useState("");
  const [boards, setBoards] = useState<Option[] | null>(null);
  const [lists, setLists] = useState<Option[] | null>(null);
  const [busy, setBusy] = useState(false);
  const config = row?.config ?? {};

  const submit = async () => {
    setBusy(true);
    try {
      const result = await connect({ key, token });
      setBoards(result.boards);
      setKey("");
      setToken("");
      toast.success("Trello connected — now pick the board and list.");
    } catch (e) {
      toast.error(message(e, "Could not connect Trello."));
    } finally {
      setBusy(false);
    }
  };

  const ensureBoards = async () => {
    if (boards) return;
    try {
      setBoards(await loadBoards());
    } catch (e) {
      toast.error(message(e, "Could not load boards."));
    }
  };

  const pickBoard = async (boardId: string) => {
    const board = boards?.find((b) => b.id === boardId);
    await setTarget({ provider: "trello", config: { boardId, boardName: board?.name ?? "", listId: "", listName: "" } });
    setLists(null);
    try {
      setLists(await loadLists({ boardId }));
    } catch (e) {
      toast.error(message(e, "Could not load lists."));
    }
  };

  const pickList = async (listId: string) => {
    const list = lists?.find((l) => l.id === listId);
    await setTarget({ provider: "trello", config: { listId, listName: list?.name ?? "" } });
    toast.success("Trello target saved.");
  };

  return (
    <Card>
      <Header title="Trello" icon={<Plug className="size-4 text-primary" />} row={row} onDisconnect={onDisconnect} />
      <CardContent className="space-y-3">
        {!row ? (
          <>
            <p className="text-sm text-muted-foreground">
              Get an API key and token at{" "}
              <a href="https://trello.com/power-ups/admin" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                trello.com/power-ups/admin
              </a>{" "}
              (create a Power-Up, generate the key, then the token).
            </p>
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Input placeholder="API key" value={key} onChange={(e) => setKey(e.target.value)} />
              <Input placeholder="Token" type="password" value={token} onChange={(e) => setToken(e.target.value)} />
              <Button onClick={submit} disabled={busy || !key.trim() || !token.trim()}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />} Connect
              </Button>
            </div>
          </>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="mb-1.5 text-xs">Board</Label>
              <Select value={config.boardId ?? ""} onValueChange={pickBoard} onOpenChange={(open) => open && ensureBoards()}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={config.boardName || "Choose a board"} />
                </SelectTrigger>
                <SelectContent>
                  {(boards ?? (config.boardId ? [{ id: config.boardId, name: config.boardName ?? "Current board" }] : [])).map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1.5 text-xs">List</Label>
              <Select
                value={config.listId ?? ""}
                onValueChange={pickList}
                onOpenChange={async (open) => {
                  if (open && !lists && config.boardId) {
                    try {
                      setLists(await loadLists({ boardId: config.boardId }));
                    } catch (e) {
                      toast.error(message(e, "Could not load lists."));
                    }
                  }
                }}
                disabled={!config.boardId}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={config.listName || "Choose a list"} />
                </SelectTrigger>
                <SelectContent>
                  {(lists ?? (config.listId ? [{ id: config.listId, name: config.listName ?? "Current list" }] : [])).map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {config.listId ? (
              <p className="flex items-center gap-1.5 text-xs text-emerald-400 sm:col-span-2">
                <CheckCircle2 className="size-3.5" /> Cards go to {config.boardName} → {config.listName}. Owners are matched to board members by name.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground sm:col-span-2">Pick the board and list that new cards should land in.</p>
            )}
            {row.lastError && <p className="text-xs text-destructive sm:col-span-2">Last error: {row.lastError}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Asana ───────────────────────────────────────────────────────────────

function AsanaCard({ row }: { row: Row | undefined }) {
  const connect = useAction(api.integrations.connectAsana);
  const loadWorkspaces = useAction(api.integrations.asanaWorkspaces);
  const loadProjects = useAction(api.integrations.asanaProjects);
  const setTarget = useMutation(api.integrations.setTarget);
  const onDisconnect = useDisconnect("asana");
  const [pat, setPat] = useState("");
  const [workspaces, setWorkspaces] = useState<{ gid: string; name: string }[] | null>(null);
  const [projects, setProjects] = useState<{ gid: string; name: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const config = row?.config ?? {};

  const submit = async () => {
    setBusy(true);
    try {
      const result = await connect({ pat });
      setWorkspaces(result.workspaces);
      setPat("");
      toast.success("Asana connected — now pick the workspace and project.");
    } catch (e) {
      toast.error(message(e, "Could not connect Asana."));
    } finally {
      setBusy(false);
    }
  };

  const ensureWorkspaces = async () => {
    if (workspaces) return;
    try {
      setWorkspaces(await loadWorkspaces());
    } catch (e) {
      toast.error(message(e, "Could not load workspaces."));
    }
  };

  const pickWorkspace = async (workspaceGid: string) => {
    const ws = workspaces?.find((w) => w.gid === workspaceGid);
    await setTarget({ provider: "asana", config: { workspaceGid, workspaceName: ws?.name ?? "", projectGid: "", projectName: "" } });
    setProjects(null);
    try {
      setProjects(await loadProjects({ workspaceGid }));
    } catch (e) {
      toast.error(message(e, "Could not load projects."));
    }
  };

  const pickProject = async (projectGid: string) => {
    const project = projects?.find((p) => p.gid === projectGid);
    await setTarget({ provider: "asana", config: { projectGid, projectName: project?.name ?? "" } });
    toast.success("Asana target saved.");
  };

  return (
    <Card>
      <Header title="Asana" icon={<Plug className="size-4 text-primary" />} row={row} onDisconnect={onDisconnect} />
      <CardContent className="space-y-3">
        {!row ? (
          <>
            <p className="text-sm text-muted-foreground">
              Create a personal access token in Asana under Settings → Apps → Developer apps.
            </p>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <Input placeholder="Personal access token" type="password" value={pat} onChange={(e) => setPat(e.target.value)} />
              <Button onClick={submit} disabled={busy || !pat.trim()}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />} Connect
              </Button>
            </div>
          </>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="mb-1.5 text-xs">Workspace</Label>
              <Select value={config.workspaceGid ?? ""} onValueChange={pickWorkspace} onOpenChange={(open) => open && ensureWorkspaces()}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={config.workspaceName || "Choose a workspace"} />
                </SelectTrigger>
                <SelectContent>
                  {(workspaces ?? (config.workspaceGid ? [{ gid: config.workspaceGid, name: config.workspaceName ?? "Current workspace" }] : [])).map((w) => (
                    <SelectItem key={w.gid} value={w.gid}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1.5 text-xs">Project</Label>
              <Select
                value={config.projectGid ?? ""}
                onValueChange={pickProject}
                onOpenChange={async (open) => {
                  if (open && !projects && config.workspaceGid) {
                    try {
                      setProjects(await loadProjects({ workspaceGid: config.workspaceGid }));
                    } catch (e) {
                      toast.error(message(e, "Could not load projects."));
                    }
                  }
                }}
                disabled={!config.workspaceGid}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={config.projectName || "Choose a project"} />
                </SelectTrigger>
                <SelectContent>
                  {(projects ?? (config.projectGid ? [{ gid: config.projectGid, name: config.projectName ?? "Current project" }] : [])).map((p) => (
                    <SelectItem key={p.gid} value={p.gid}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {config.projectGid ? (
              <p className="flex items-center gap-1.5 text-xs text-emerald-400 sm:col-span-2">
                <CheckCircle2 className="size-3.5" /> Tasks go to {config.workspaceName} → {config.projectName}. Owners are matched to workspace members by name.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground sm:col-span-2">Pick the workspace and project that new tasks should land in.</p>
            )}
            {row.lastError && <p className="text-xs text-destructive sm:col-span-2">Last error: {row.lastError}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Webhook ─────────────────────────────────────────────────────────────

function WebhookCard({ row }: { row: Row | undefined }) {
  const connect = useAction(api.integrations.connectWebhook);
  const onDisconnect = useDisconnect("webhook");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await connect({ url, secret: secret || undefined });
      setUrl("");
      setSecret("");
      toast.success("Webhook connected — the test ping got a 2xx.");
    } catch (e) {
      toast.error(message(e, "Could not connect the webhook."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Header title="Webhook (Zapier, Make, n8n, your own)" icon={<Webhook className="size-4 text-primary" />} row={row} onDisconnect={onDisconnect} />
      <CardContent className="space-y-3">
        {!row ? (
          <>
            <p className="text-sm text-muted-foreground">
              We POST a JSON payload (meeting, summary, decisions, action items with owner and
              due date) to your URL after each meeting. Add a secret and we send it in the
              X-GWU-Secret header.
            </p>
            <div className="grid gap-2 sm:grid-cols-[1.5fr_1fr_auto]">
              <Input placeholder="https://hooks.zapier.com/…" value={url} onChange={(e) => setUrl(e.target.value)} />
              <Input placeholder="Secret (optional)" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} />
              <Button onClick={submit} disabled={busy || !url.trim()}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />} Connect
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">Sending to {row.config.url}</p>
            {row.lastError && <p className="text-xs text-destructive">Last error: {row.lastError}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
