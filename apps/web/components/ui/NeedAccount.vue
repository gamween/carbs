<template>
  <div class="panel max-w-xl" data-testid="need-account">
    <p class="panel-title">No account yet</p>
    <p class="mt-2 text-muted-foreground">
      Create a Mac account or set up the Ledger account first, on the Account screen. The node, not
      this page, holds its state.
    </p>
    <NuxtLink to="/account" class="btn btn-primary mt-4">Go to Account</NuxtLink>
  </div>
</template>
