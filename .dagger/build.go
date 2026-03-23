package main

import (
	"dagger/ra-atr/internal/dagger"
)

// BuildFrontend builds the frontend container from .docker/frontend.dockerfile.
func (m *RaAtr) BuildFrontend(source *dagger.Directory) *dagger.Container {
	return source.
		DockerBuild(dagger.DirectoryDockerBuildOpts{
			Dockerfile: ".docker/frontend.dockerfile",
		})
}
