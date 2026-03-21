package main

import (
	"context"
	"fmt"

	"dagger/lejonet/internal/dagger"

	"golang.org/x/sync/errgroup"
)

// PrettierCheck checks that frontend code is formatted with prettier.
func (m *Lejonet) PrettierCheck(ctx context.Context, source *dagger.Directory) (string, error) {
	return m.buildFrontendDev(source).
		WithExec([]string{"npx", "prettier", "--check", "src/**/*.{svelte,ts,js,css}"}).
		Stdout(ctx)
}

// SvelteCheck runs svelte-check type checking on the frontend.
func (m *Lejonet) SvelteCheck(ctx context.Context, source *dagger.Directory) (string, error) {
	return m.buildFrontendDev(source).
		WithExec([]string{"npx", "svelte-check", "--threshold", "error"}).
		Stdout(ctx)
}

// Checks runs all lint and type-check tasks in parallel.
func (m *Lejonet) Checks(ctx context.Context, source *dagger.Directory) error {
	g, ctx := errgroup.WithContext(ctx)

	g.Go(func() error {
		_, err := m.PrettierCheck(ctx, source)
		if err != nil {
			return fmt.Errorf("prettier: %w", err)
		}
		return nil
	})

	g.Go(func() error {
		_, err := m.SvelteCheck(ctx, source)
		if err != nil {
			return fmt.Errorf("svelte-check: %w", err)
		}
		return nil
	})

	return g.Wait()
}
