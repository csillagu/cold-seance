import { execFileSync } from 'node:child_process'

/** The image under test, built beforehand: `docker build -t cold-seance:test .` */
export function testImage(): string {
  const image = process.env['TEST_IMAGE']
  if (!image) {
    throw new Error(
      'TEST_IMAGE is not set. Build the image (docker build -t cold-seance:test .) and set ' +
        'TEST_IMAGE=cold-seance:test.',
    )
  }
  return image
}

/** Runs the Docker CLI and returns what it prints, failing if it fails. */
export function docker(...args: string[]): string {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

/** The address of `url` as a container sees it: the Docker host's own services are on host.docker.internal. */
export function fromContainer(url: string): string {
  const address = new URL(url)
  if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(address.hostname)) {
    address.hostname = 'host.docker.internal'
  }
  return address.toString()
}
