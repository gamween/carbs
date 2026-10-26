<script setup lang="ts">
import SimBadge from "~/components/ui/SimBadge.vue";
import { CARBS_AMENDMENTS } from "~/lib/amendments";
import { useBackend } from "~/lib/context";

const backend = useBackend();

/** This fork's amendments, as `infra/standalone.cfg` enables them (a test checks the file). */
const AMENDMENTS = CARBS_AMENDMENTS.map((a) => `${a.name} (${a.what})`);

const SCREENS = [
  {
    to: "/account",
    title: "Account",
    body: "Two post-quantum accounts: a Mac account whose ML-DSA-44 key Touch ID unlocks, or a Ledger account.",
  },
  {
    to: "/session",
    title: "Session",
    body: "Open a short-lived key in mode A, P or C, watch it count down and spend.",
  },
  {
    to: "/actions",
    title: "Actions",
    body: "Six transaction types signed by the session key with no prompt.",
  },
  {
    to: "/attack",
    title: "Attack",
    body: "Replay what a stolen key could try. The refusals are the node's own codes.",
  },
  {
    to: "/apps",
    title: "Apps",
    body: "Six live apps on the team's node, each opening one session with its own limits.",
  },
  {
    to: "/quantum",
    title: "Quantum",
    body: "Is an account's public key already on the ledger? Then migrate with the Ledger.",
  },
] as const;
</script>

<template>
  <section>
    <p class="eyebrow mb-2">carbs</p>
    <h1 class="text-3xl md:text-4xl">Quantum-safe and delegable, enforced by the ledger</h1>
    <p class="mt-4 max-w-2xl text-lg text-muted-foreground">
      A post-quantum root key on a Ledger device or behind Touch ID, and signing sessions that the
      ledger itself confines in time, in transaction types and in XRP spent. Full post-quantum: no
      classical key in the flow, except the master key, which the setup disables.
    </p>
    <p class="mt-3 max-w-2xl text-sm text-muted-foreground" data-testid="amendments">
      A node started from this repository's configuration enables {{ AMENDMENTS.length }} amendments
      of this fork: {{ AMENDMENTS.join(", ") }}. The public AlphaNet has none of them.
    </p>
    <p
      v-if="backend.mode === 'simulated'"
      class="panel sim-frame mt-6 max-w-2xl text-sm"
      data-testid="sim-note"
    >
      <SimBadge /> The node and the device are simulated. To use a real node, pick Local node or
      Team node under Node, at the top. The badge marks every result that comes from the simulation.
    </p>
    <div class="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <NuxtLink
        v-for="screen in SCREENS"
        :key="screen.to"
        :to="screen.to"
        class="panel block transition-transform duration-base hover:-translate-y-0.5"
      >
        <h2 class="panel-title">{{ screen.title }}</h2>
        <p class="mt-2 text-sm text-muted-foreground">{{ screen.body }}</p>
      </NuxtLink>
    </div>
  </section>
</template>
