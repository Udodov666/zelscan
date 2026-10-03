[IO.Compression.GZipStream]::new([IO.File]::OpenRead('landing\__states_js.js.gz'),[IO.Compression.CompressionMode]::Decompress).CopyTo([IO.File]::Create('landing\order-tariff-states.js'))
