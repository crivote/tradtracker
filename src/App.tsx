import { A } from '@solidjs/router';

export default function App() {
  return (
    <div class="min-h-screen bg-gray-900 text-gray-100">
      <header class="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <h1 class="text-2xl font-bold text-amber-400">🎵 TradTracker</h1>
        <p class="text-sm text-gray-400 mt-1">
          Irish Traditional Music Practice Manager
        </p>
      </header>
      <main class="max-w-7xl mx-auto px-6 py-8">
        <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h2 class="text-lg font-semibold mb-4">Welcome to TradTracker</h2>
          <p class="text-gray-300">
            Manage your repertoire, track practice sessions, and get intelligent
            suggestions for what to practice next.
          </p>
          <div class="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div class="bg-gray-750 rounded p-4 border border-gray-600">
              <h3 class="font-medium text-amber-300">📚 Repertoire</h3>
              <p class="text-sm text-gray-400 mt-1">Your personal collection of tunes</p>
            </div>
            <div class="bg-gray-750 rounded p-4 border border-gray-600">
              <h3 class="font-medium text-amber-300">🥁 Practice</h3>
              <p class="text-sm text-gray-400 mt-1">Track your sessions and progress</p>
            </div>
            <div class="bg-gray-750 rounded p-4 border border-gray-600">
              <h3 class="font-medium text-amber-300">🔄 Rotation</h3>
              <p class="text-sm text-gray-400 mt-1">Smart daily practice lists</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
