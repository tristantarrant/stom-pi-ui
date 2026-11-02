/* Grid alignment for the pedalboard editor (stom-pi feature).
 * Two top-bar buttons drive this module:
 *   - #js-grid-toggle    snaps a plugin to the grid when it is dropped after being moved, or when newly added by drag & drop from the library. Toggling only affects future moves; existing pedals are left alone until explicitly aligned.
 *   - #js-align-to-grid  immediately aligns every plugin currently on the board to the nearest grid point and persists each move through the same path a manual drag uses (pluginMove).
 */
(function () {

    var GRID_SIZE = 50 // board pixels; adjust here if another pitch is wanted

    function snap(v) {
        return Math.max(0, Math.round(v / GRID_SIZE) * GRID_SIZE)
    }

    window.ModGrid = {
        size: GRID_SIZE,
        enabled: false,

        /* Returns the (x, y) position snapped to the grid when grid mode is on, unchanged otherwise. */
        alignXY: function (x, y) {
            if (!this.enabled) return { x: x, y: y }
            return { x: snap(x), y: snap(y) }
        },

        toggle: function () {
            this.enabled = !this.enabled
            var btn = $('#js-grid-toggle')
            btn.toggleClass('selected', this.enabled)
            btn.text(this.enabled ? 'Grid On' : 'Grid Off')
        },

        alignAll: function (pedalboardEl) {
            var pb = $(pedalboardEl)
            var plugins = pb.data('plugins') || {}
            for (var instance in plugins) {
                if (!plugins.hasOwnProperty(instance)) continue
                var icon = plugins[instance]
                var x = parseInt(icon.css('left'))
                var y = parseInt(icon.css('top'))
                var nx = snap(x)
                var ny = snap(y)
                if (nx === x && ny === y) continue
                icon.stop(true).css({ left: nx, top: ny })
                pb.pedalboard('drawPluginJacks', icon)
                var move = pb.data('pluginMove')
                if (move) move(instance, nx, ny)
            }
        }
    }

    $(document).ready(function () {
        $('#js-grid-toggle').click(function () { ModGrid.toggle() })
        $('#js-align-to-grid').click(function () { ModGrid.alignAll($('#pedalboard-dashboard')) })
    })
})()
