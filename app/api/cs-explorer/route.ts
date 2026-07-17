import { NextRequest, NextResponse } from "next/server";
import pool from "../../../lib/db";

type TicketRow = {
  ticket_id: string;
  ticket_created_at: Date | string;
  channel: string | null;
  tags: string | null;
  total_orders_found: number | null;
  customer_type: string | null;
};

type MessageRow = {
  ticket_id: string;
  created_at: Date | string;
  from_agent: number;
  public?: number | null;
  via?: string | null;
  rule_id?: string | null;
  sender_email?: string | null;
};

const CHANNELS: Record<string, string> = {
  email: "Email",
  chat: "Chat",
  "help-center": "Help Center",
  helpcenter: "Help Center",
  contact_form: "Help Center",
  sms: "SMS",
  twilio: "SMS",
  phone: "Phone",
  aircall: "Phone",
  facebook: "Social",
  "facebook-messenger": "Social",
  "instagram-ad-comment": "Social",
  "instagram-dm": "Social",
};

function tagsOf(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((tag) => typeof tag === "string" ? tag : tag?.name).filter(Boolean);
    }
  } catch { /* reporting-sync stores comma-separated tag names */ }
  return value.split(",").map((tag) => tag.trim()).filter(Boolean);
}

function ticketChannel(ticket: TicketRow, tags: string[]) {
  if (tags.some((tag) => tag.toLowerCase() === "klaviyo-sms")) return "SMS";
  const channel = (ticket.channel ?? "").toLowerCase();
  return CHANNELS[channel] ?? (channel ? channel.replace(/(^|-)(\w)/g, (_, p, c) => `${p ? " " : ""}${c.toUpperCase()}`) : "Unknown");
}

function customerType(value: string | null, totalOrders: number | null) {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "lead") return "Lead";
  if (normalized === "new" || normalized === "new (1 order)") return "New (1 Order)";
  if (normalized === "recurring") return "Recurring";
  if (totalOrders === 1) return "New (1 Order)";
  if (totalOrders && totalOrders > 1) return "Recurring";
  return "Lead";
}

function duration(seconds: number | null) {
  if (seconds == null) return "";
  const rounded = Math.round(seconds);
  const days = Math.floor(rounded / 86400);
  const hours = Math.floor((rounded % 86400) / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}min${minutes === 1 ? "" : "s"}`;
  if (minutes) return `${minutes}m ${secs}sec${secs === 1 ? "" : "s"}`;
  return `${secs}secs`;
}

function parseDate(value: string | null, fallback: Date) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

export async function GET(req: NextRequest) {
  const now = new Date();
  const defaultStart = new Date(now.getTime() - 6 * 86400000);
  const start = parseDate(req.nextUrl.searchParams.get("start"), defaultStart);
  const inclusiveEnd = parseDate(req.nextUrl.searchParams.get("end"), now);
  const end = new Date(inclusiveEnd.getTime() + 86400000);
  if (end <= start || end.getTime() - start.getTime() > 366 * 86400000) {
    return NextResponse.json({ error: "Choose a valid range of up to 366 days." }, { status: 400 });
  }

  const channelFilters = req.nextUrl.searchParams.getAll("channel");
  const customerFilters = req.nextUrl.searchParams.getAll("customerType");
  try {
    const [ticketRows] = await pool.query(
      `SELECT ticket_id, ticket_created_at, channel, tags, total_orders_found, customer_type
       FROM gorgias_tickets
       WHERE ticket_created_at >= ? AND ticket_created_at < ?
       ORDER BY ticket_created_at`,
      [start, end],
    );
    const tickets = ticketRows as TicketRow[];
    const selected = tickets.filter((ticket) => {
      const tags = tagsOf(ticket.tags);
      const channel = ticketChannel(ticket, tags);
      const ctype = customerType(ticket.customer_type, ticket.total_orders_found);
      return (!channelFilters.length || channelFilters.includes(channel))
        && (!customerFilters.length || customerFilters.includes(ctype));
    });

    const [messageColumns] = await pool.query("SHOW COLUMNS FROM gorgias_messages");
    const columns = new Set((messageColumns as { Field: string }[]).map((column) => column.Field));
    const optional = ["public", "via", "rule_id", "sender_email"]
      .map((name) => columns.has(name) ? name : `NULL AS ${name}`).join(", ");
    const messages: MessageRow[] = [];
    for (let offset = 0; offset < selected.length; offset += 500) {
      const ids = selected.slice(offset, offset + 500).map((ticket) => ticket.ticket_id);
      if (!ids.length) continue;
      const placeholders = ids.map(() => "?").join(",");
      const [rows] = await pool.query(
        `SELECT ticket_id, created_at, from_agent, ${optional}
         FROM gorgias_messages
         WHERE ticket_id IN (${placeholders}) AND created_at >= ? AND created_at < ?`,
        [...ids, start, end],
      );
      messages.push(...rows as MessageRow[]);
    }

    const ticketById = new Map(selected.map((ticket) => [String(ticket.ticket_id), ticket]));
    const firstReplies = new Map<string, number>();
    let messagesSent = 0;
    for (const message of messages) {
      if (!message.from_agent) continue;
      if (columns.has("public") && !message.public) continue;
      const sender = (message.sender_email ?? "").toLowerCase();
      if (sender.endsWith("@email.gorgias.com") || message.rule_id || (message.via ?? "").toLowerCase() === "rule") continue;
      messagesSent += 1;
      const id = String(message.ticket_id);
      const ticket = ticketById.get(id);
      if (!ticket) continue;
      const replyAt = new Date(message.created_at).getTime();
      const createdAt = new Date(ticket.ticket_created_at).getTime();
      const seconds = (replyAt - createdAt) / 1000;
      if (seconds >= 0 && (!firstReplies.has(id) || seconds < firstReplies.get(id)!)) {
        firstReplies.set(id, seconds);
      }
    }
    const frtSamples = [...firstReplies.values()];
    const frtSeconds = frtSamples.length
      ? frtSamples.reduce((sum, value) => sum + value, 0) / frtSamples.length
      : null;

    const channelOptions = [...new Set(tickets.map((ticket) => ticketChannel(ticket, tagsOf(ticket.tags))))].sort();
    const coverage = messages.length
      ? {
          messageRows: messages.length,
          from: new Date(Math.min(...messages.map((message) => new Date(message.created_at).getTime()))).toISOString(),
          to: new Date(Math.max(...messages.map((message) => new Date(message.created_at).getTime()))).toISOString(),
        }
      : { messageRows: 0, from: null, to: null };

    return NextResponse.json({
      metrics: {
        ticketsCreated: selected.length,
        messagesSent,
        frtSeconds,
        frtDisplay: duration(frtSeconds),
        frtCount: frtSamples.length,
      },
      options: {
        channels: channelOptions,
        customerTypes: ["Lead", "New (1 Order)", "Recurring"],
      },
      coverage,
      definitions: {
        sms: "Tag > klaviyo-sms",
        frt: "First public human agent reply; @email.gorgias.com and rule senders excluded",
      },
    });
  } catch (error) {
    console.error("cs explorer api error:", error);
    return NextResponse.json({ error: "Failed to calculate filtered metrics." }, { status: 500 });
  }
}
