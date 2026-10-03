[IO.Compression.GZipStream]::new([IO.File]::OpenRead('landing\__states_css.css.gz'),[IO.Compression.CompressionMode]::Decompress).CopyTo([IO.File]::Create('landing\order-tariff-states.css'))
