// SPDX-FileCopyrightText: 2012-2023 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

JqueryClass('fileManagerBox', {
    init: function (options) {
        var self = $(this)

        options = $.extend({
            isMainWindow: true,
            windowName: "File Manager",
        }, options)

        self.data(options)

        options.open = function () {
            console.log("FileManager open")
            if (! self.data('loaded')) {
                var url = '/filebrowser.html'  // stom-pi: built-in user-files browser, same origin as the UI server (replaces external :8081 service)
                self.find('iframe').attr('src', url)
                self.data('loaded', true)
            }
            return false
        }

        self.window(options)
    },

    setCategory: function (category) {
        var self = $(this)
    },
})
