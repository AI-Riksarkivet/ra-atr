// ra-atr CI/CD pipeline powered by Dagger
//
// Provides build, lint, type-check, and serve functions for the
// ra-atr frontend (SvelteKit/Node).

package main

import (
	"dagger/ra-atr/internal/dagger"
)

const (
	nodeImage   = "node:22-slim"
	frontendDir = "frontend"
)

type RaAtr struct{}

// buildFrontendDev returns a Node container with frontend deps installed.
func (m *RaAtr) buildFrontendDev(source *dagger.Directory) *dagger.Container {
	frontend := source.Directory(frontendDir)

	return dag.Container().From(nodeImage).
		WithMountedCache("/root/.npm", dag.CacheVolume("npm-cache")).
		WithMountedDirectory("/app", frontend).
		WithWorkdir("/app").
		WithExec([]string{"npm", "ci"})
}
